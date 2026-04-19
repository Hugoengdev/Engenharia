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

  // Animation loop
  useEffect(() => {
    if (!isPlaying || !bounds || !currentDate || !effectiveStart) return;
    const totalMs = bounds.max.getTime() - effectiveStart.getTime();
    if (totalMs <= 0) return;
    let last = performance.now();

    const step = (now: number) => {
      const dt = now - last;
      last = now;
      // 1x = traverse full timeline in 30 seconds
      const advance = (dt / 30000) * playSpeed * totalMs;
      const next = new Date(currentDate.getTime() + advance);
      if (next.getTime() >= bounds.max.getTime()) {
        setCurrentDate(bounds.max);
        setPlaying(false);
        return;
      }
      setCurrentDate(next);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    bounds,
    currentDate,
    effectiveStart,
    playSpeed,
    setCurrentDate,
    setPlaying,
  ]);

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
    <Card className="border-border/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Data atual
          </div>
          <div className="font-mono text-base font-semibold">
            {formatDate(currentDate ?? start)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={toStart}
            title={
              statusDate &&
              effectiveStart &&
              effectiveStart.getTime() === statusDate.getTime()
                ? "Ir para a data de status"
                : "Ir para o início"
            }
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            onClick={() => setPlaying(!isPlaying)}
            disabled={!currentDate}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button size="icon" variant="outline" onClick={toEnd}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={nextSpeed}
            className="font-mono"
          >
            <Gauge className="h-3.5 w-3.5" />
            {playSpeed}x
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <Slider
          value={[sliderValue]}
          min={0}
          max={1000}
          step={1}
          onValueChange={setFromSlider}
        />
        <div className="mt-1 flex justify-between text-[10px] font-mono text-muted-foreground">
          <span>
            {formatDate(start)}
            {statusDate &&
              start.getTime() === statusDate.getTime() && (
                <span className="ml-1 text-primary">• data de status</span>
              )}
          </span>
          <span>{formatDate(bounds.max)}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 text-primary" />
          Data de status
        </div>
        <input
          type="date"
          value={statusEditor}
          onChange={(e) => setStatusEditor(e.target.value)}
          min={toDateInputValue(bounds.min)}
          max={toDateInputValue(bounds.max)}
          className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs font-mono text-foreground outline-none focus:border-primary/60"
          disabled={!scheduleId || savingStatus}
        />
        {editorDirty && (
          <Button
            size="sm"
            onClick={handleSaveStatus}
            disabled={savingStatus || !scheduleId}
            className="h-8"
          >
            <Check className="h-3.5 w-3.5" />
            Salvar
          </Button>
        )}
        {statusDate && !editorDirty && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleClearStatus}
            disabled={savingStatus}
            className="h-8"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        )}
        {!statusDate && !editorDirty && (
          <span className="text-[11px] text-muted-foreground">
            Tarefas finalizadas antes dessa data já aparecem construídas.
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        <Stat
          color="bg-secondary"
          label="Pendente"
          value={stats.notStarted}
        />
        <Stat
          color="bg-yellow-500"
          label="Em execução"
          value={stats.inProgress}
        />
        <Stat
          color="bg-green-500"
          label="No prazo"
          value={stats.doneOnTime}
        />
        <Stat
          color="bg-red-500"
          label="Atrasada"
          value={stats.doneDelayed}
        />
      </div>
    </Card>
  );
}

function Stat({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/30 p-2">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
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
