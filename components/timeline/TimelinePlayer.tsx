"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Gauge,
  CalendarClock,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import {
  classifyTask,
  scheduleBounds,
  taskDelayStatus,
  useProjectStore,
} from "@/lib/store/projectStore";
import { formatDate } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { ViewerEngine, ElementState } from "@/lib/ifc/viewerEngine";

interface Props {
  engine: ViewerEngine | null;
}

const SPEEDS = [0.5, 1, 2, 5, 10];

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function TimelinePlayer({ engine }: Props) {
  const tasks = useProjectStore((s) => s.tasks);
  const scheduleId = useProjectStore((s) => s.scheduleId);
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId);
  const statusDate = useProjectStore((s) => s.statusDate);
  const setStatusDate = useProjectStore((s) => s.setStatusDate);
  const currentDate = useProjectStore((s) => s.currentDate);
  const setCurrentDate = useProjectStore((s) => s.setCurrentDate);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setPlaying = useProjectStore((s) => s.setPlaying);
  const playSpeed = useProjectStore((s) => s.playSpeed);
  const setPlaySpeed = useProjectStore((s) => s.setPlaySpeed);
  const rafRef = useRef<number | null>(null);

  const [statusEditor, setStatusEditor] = useState<string>("");
  const [savingStatus, setSavingStatus] = useState(false);

  const bounds = useMemo(() => scheduleBounds(tasks), [tasks]);

  // Effective playback window: timeline scrubs from statusDate (when set)
  // up to the end of the schedule.
  const effectiveStart = useMemo(() => {
    if (!bounds) return null;
    if (statusDate && statusDate > bounds.min && statusDate < bounds.max) {
      return statusDate;
    }
    return bounds.min;
  }, [bounds, statusDate]);

  // Keep the local input in sync with the store.
  useEffect(() => {
    setStatusEditor(toDateInputValue(statusDate));
  }, [statusDate]);

  // Initialize currentDate: prefer statusDate so the 4D opens at the
  // reporting date showing everything before it as done.
  useEffect(() => {
    if (!bounds) return;
    if (!currentDate) {
      setCurrentDate(effectiveStart ?? bounds.min);
    }
  }, [bounds, effectiveStart, currentDate, setCurrentDate]);

  // When the status date changes, snap playback back to it so the user
  // sees the new starting point right away.
  useEffect(() => {
    if (!bounds) return;
    if (!effectiveStart) return;
    if (!currentDate || currentDate < effectiveStart) {
      setCurrentDate(effectiveStart);
    }
    // intentionally only reacting to statusDate changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusDate]);

  // Apply 4D state to viewer whenever date or tasks change.
  // The timeline is driven by BASELINE dates. Color after baseline_end:
  //   green  → forecast end_date ≤ baseline_end (on time / ahead)
  //   red    → forecast end_date >  baseline_end (atrasada)
  useEffect(() => {
    if (!engine || !currentDate) return;
    const states = new Map<string, ElementState>();

    // Elements of the currently-edited task must remain visible so the user
    // can see the "select" highlight regardless of 4D timeline state.
    const excluded = new Set<string>();
    if (selectedTaskId) {
      const st = tasks.find((t) => t.id === selectedTaskId);
      if (st) for (const gid of st.ifc_global_ids) excluded.add(gid);
    }

    // First pass: hide all linked elements (those without a task remain default)
    const allLinked = new Set<string>();
    for (const t of tasks) {
      for (const gid of t.ifc_global_ids) allLinked.add(gid);
    }
    for (const gid of allLinked) {
      if (excluded.has(gid)) continue;
      states.set(gid, "hidden");
    }

    // Second pass: in_progress and done override hidden.
    // Done elements are colored green or red based on forecast vs baseline.
    // Priority: done > in_progress > hidden (later tasks covering the same
    // element pick the "stronger" state).
    const rank: Record<ElementState, number> = {
      default: 0,
      hidden: 1,
      in_progress: 2,
      done_on_time: 3,
      done_delayed: 3,
    };

    for (const t of tasks) {
      const status = classifyTask(t, currentDate);
      if (status === "not_started") continue;
      let target: ElementState;
      if (status === "done") {
        target =
          taskDelayStatus(t) === "delayed" ? "done_delayed" : "done_on_time";
      } else {
        target = "in_progress";
      }
      for (const gid of t.ifc_global_ids) {
        if (excluded.has(gid)) continue;
        const cur = states.get(gid) ?? "default";
        if (rank[target] > rank[cur]) states.set(gid, target);
      }
    }

    engine.apply4DState(states).catch((err) => {
      console.warn("[timeline] apply4DState failed:", err);
    });
  }, [engine, tasks, currentDate, selectedTaskId]);

  // Live refs so the animation loop reads the *current* values without
  // re-subscribing the effect on every frame. Keeping `currentDate` in the
  // dependency array caused the effect to tear down/rebuild at every tick
  // — and when React's render was slow (many components on screen), an
  // orphaned rAF from a previous effect instance would fire with a stale
  // closure of `currentDate` and overwrite the store with an older date,
  // making the timeline visibly walk *backwards*.
  const currentDateRef = useRef<Date | null>(currentDate);
  const playSpeedRef = useRef<number>(playSpeed);
  useEffect(() => {
    currentDateRef.current = currentDate;
  }, [currentDate]);
  useEffect(() => {
    playSpeedRef.current = playSpeed;
  }, [playSpeed]);

  // Animation loop — depends only on play state + bounds. Reads the live
  // date/speed from the refs above.
  useEffect(() => {
    if (!isPlaying || !bounds || !effectiveStart) return;
    const totalMs = bounds.max.getTime() - effectiveStart.getTime();
    if (totalMs <= 0) return;
    let last = performance.now();
    let cancelled = false;

    const step = (now: number) => {
      if (cancelled) return;
      const dt = Math.max(0, now - last);
      last = now;
      const current = currentDateRef.current ?? effectiveStart;
      // 1x = traverse full timeline in 30 seconds. Clamped positive so a
      // weird `performance.now()` hop (tab throttling, etc.) can never
      // push the date backwards.
      const advance = Math.max(
        0,
        (dt / 30000) * playSpeedRef.current * totalMs
      );
      const nextMs = current.getTime() + advance;
      if (nextMs >= bounds.max.getTime()) {
        setCurrentDate(bounds.max);
        setPlaying(false);
        return;
      }
      setCurrentDate(new Date(nextMs));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, bounds, effectiveStart, setCurrentDate, setPlaying]);

  async function persistStatusDate(value: string | null) {
    if (!scheduleId) {
      toast.error("Importe um cronograma antes de definir a data de status.");
      return;
    }
    setSavingStatus(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("schedules")
        .update({ status_date: value })
        .eq("id", scheduleId);
      if (error) throw error;
      setStatusDate(value ? new Date(`${value}T00:00:00`) : null);
      toast.success(
        value
          ? `Data de status definida para ${formatDate(
              new Date(`${value}T00:00:00`)
            )}`
          : "Data de status removida"
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao salvar data de status"
      );
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleSaveStatus() {
    await persistStatusDate(statusEditor ? statusEditor : null);
  }

  async function handleClearStatus() {
    setStatusEditor("");
    if (statusDate) await persistStatusDate(null);
  }

  if (!bounds) {
    return (
      <Card className="p-4 text-xs text-muted-foreground">
        Timeline indisponível — sem tarefas com datas.
      </Card>
    );
  }

  const start = effectiveStart ?? bounds.min;
  const totalMs = bounds.max.getTime() - start.getTime();
  const offsetMs =
    (currentDate?.getTime() ?? start.getTime()) - start.getTime();
  const sliderValue =
    totalMs > 0 ? Math.max(0, Math.min(1000, (offsetMs / totalMs) * 1000)) : 0;

  function setFromSlider(v: number[]) {
    if (!bounds) return;
    const ratio = v[0] / 1000;
    setCurrentDate(new Date(start.getTime() + ratio * totalMs));
  }

  function toStart() {
    setCurrentDate(start);
  }
  function toEnd() {
    if (bounds) setCurrentDate(bounds.max);
  }
  function nextSpeed() {
    const i = SPEEDS.indexOf(playSpeed);
    setPlaySpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  const stats = computeStats(tasks, currentDate ?? start);
  const editorDirty = statusEditor !== toDateInputValue(statusDate);

  return (
    <Card className="border-border/60 px-3 py-2">
      {/* Row 1 — current date on the left, transport controls on the right.
          Kept intentionally dense so the whole player fits under the viewer
          even on narrower screens now that the Gantt owns more horizontal
          space. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Data atual
          </div>
          <div className="truncate font-mono text-sm font-semibold leading-tight">
            {formatDate(currentDate ?? start)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            onClick={toStart}
            className="h-7 w-7"
            title={
              statusDate &&
              effectiveStart &&
              effectiveStart.getTime() === statusDate.getTime()
                ? "Ir para a data de status"
                : "Ir para o início"
            }
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            onClick={() => setPlaying(!isPlaying)}
            disabled={!currentDate}
            className="h-7 w-7"
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={toEnd}
            className="h-7 w-7"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={nextSpeed}
            className="h-7 px-2 font-mono text-xs"
            title="Velocidade de reprodução"
          >
            <Gauge className="h-3 w-3" />
            {playSpeed}x
          </Button>
        </div>
      </div>

      {/* Row 2 — scrubber. Labels stay inline so we don't spend a line
          just on the bounds. */}
      <div className="mt-2">
        <Slider
          value={[sliderValue]}
          min={0}
          max={1000}
          step={1}
          onValueChange={setFromSlider}
        />
        <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span className="truncate">
            {formatDate(start)}
            {statusDate &&
              start.getTime() === statusDate.getTime() && (
                <span className="ml-1 text-primary">• data de status</span>
              )}
          </span>
          <span className="truncate">{formatDate(bounds.max)}</span>
        </div>
      </div>

      {/* Row 3 — status date editor inline with the stats chips. The chips
          shrink from full cards to compact pills; the information (label +
          number) is preserved, just packed more tightly. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            <CalendarClock className="h-3 w-3 text-primary" />
            Status
          </div>
          <input
            type="date"
            value={statusEditor}
            onChange={(e) => setStatusEditor(e.target.value)}
            min={toDateInputValue(bounds.min)}
            max={toDateInputValue(bounds.max)}
            className="h-7 rounded-md border border-border/60 bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary/60"
            disabled={!scheduleId || savingStatus}
          />
          {editorDirty && (
            <Button
              size="icon"
              onClick={handleSaveStatus}
              disabled={savingStatus || !scheduleId}
              className="h-7 w-7"
              title="Salvar data de status"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          {statusDate && !editorDirty && (
            <Button
              size="icon"
              variant="outline"
              onClick={handleClearStatus}
              disabled={savingStatus}
              className="h-7 w-7"
              title="Limpar data de status"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
          <StatPill
            color="bg-secondary"
            label="Pendente"
            value={stats.notStarted}
          />
          <StatPill
            color="bg-yellow-500"
            label="Em execução"
            value={stats.inProgress}
          />
          <StatPill
            color="bg-green-500"
            label="No prazo"
            value={stats.doneOnTime}
          />
          <StatPill
            color="bg-red-500"
            label="Atrasada"
            value={stats.doneDelayed}
          />
        </div>
      </div>

      {!statusDate && !editorDirty && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          Tarefas finalizadas antes da data de status já aparecem construídas.
        </p>
      )}
    </Card>
  );
}

function StatPill({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border/60 bg-secondary/30 px-1.5 py-0.5">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

function computeStats(
  tasks: {
    baseline_start: string;
    baseline_end: string;
    end_date: string;
  }[],
  current: Date
) {
  let notStarted = 0;
  let inProgress = 0;
  let doneOnTime = 0;
  let doneDelayed = 0;
  for (const t of tasks) {
    const s = new Date(t.baseline_start);
    const e = new Date(t.baseline_end);
    if (current < s) {
      notStarted++;
    } else if (current >= e) {
      if (new Date(t.end_date) > new Date(t.baseline_end)) doneDelayed++;
      else doneOnTime++;
    } else {
      inProgress++;
    }
  }
  return { notStarted, inProgress, doneOnTime, doneDelayed };
}
