"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Target, TrendingUp } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectStore } from "@/lib/store/projectStore";
import type {
  ClassificationSummary,
  PropertyGroup,
  ViewerEngine,
} from "@/lib/ifc/viewerEngine";
import type { TaskWithLinks } from "@/lib/store/projectStore";

interface Props {
  engine: ViewerEngine | null;
}

type Basis = "baseline" | "forecast";

const NONE_VALUE = "__none__";

/**
 * Two KPI cards sitting above the whole workspace. Each one picks a numeric
 * property from the IFC (volume, area, count, weight…) and shows how much
 * of that quantity is "realized" at the current 4D timeline date. The
 * first card is driven by the baseline dates (linha base) and the second
 * by the forecast dates (tendência), so you can eyeball planned vs
 * projected progress side by side while scrubbing the timeline.
 */
export function QuantitySummaryBoxes({ engine }: Props) {
  const tasks = useProjectStore((s) => s.tasks);
  const currentDate = useProjectStore((s) => s.currentDate);

  // We need to know which properties exist so the user can pick one. The
  // engine only scans on-demand (it can be expensive on large IFCs), so we
  // kick off the scan here the first time this component mounts with an
  // engine. The scan is idempotent and the result is cached on the engine,
  // so the ClassificationBrowser (which also reads it) sees the same data.
  const [summary, setSummary] = useState<ClassificationSummary>(() => ({
    systems: [],
    properties: [],
    propertiesScanned: false,
  }));

  useEffect(() => {
    if (!engine) {
      setSummary({ systems: [], properties: [], propertiesScanned: false });
      return;
    }
    let cancelled = false;
    let scanTriggered = false;

    // Kick off the (expensive) Pset scan once systems have landed — that's
    // the signal the IFC is actually loaded. Scanning before the model is
    // there is a no-op, so we'd end up with `propertiesScanned=true` and an
    // empty list forever, which is exactly the bug the user hit.
    const maybeScan = (next: ClassificationSummary) => {
      if (scanTriggered) return;
      if (next.propertiesScanned) return;
      if (next.systems.length === 0) return;
      scanTriggered = true;
      engine
        .scanPropertyGroups()
        .then((res) => {
          if (!cancelled) setSummary(res);
        })
        .catch(() => {
          if (!cancelled) {
            setSummary((prev) => ({ ...prev, propertiesScanned: true }));
          }
        });
    };

    // Grab the current state synchronously in case the model was already
    // loaded before this component mounted.
    const current = engine.getClassifications();
    setSummary(current);
    maybeScan(current);

    const off = engine.addClassificationsListener((next) => {
      if (cancelled) return;
      setSummary(next);
      maybeScan(next);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, [engine]);

  const numericGroups = useMemo<PropertyGroup[]>(
    () =>
      summary.properties.filter((g) =>
        g.values.some((v) => Number.isFinite(Number(v.key)))
      ),
    [summary.properties]
  );

  const [propKey1, setPropKey1] = useState<string>(NONE_VALUE);
  const [propKey2, setPropKey2] = useState<string>(NONE_VALUE);

  return (
    <div className="grid grid-cols-2 gap-2">
      <SummaryBox
        engine={engine}
        tasks={tasks}
        currentDate={currentDate}
        propertyKey={propKey1}
        onPropertyChange={setPropKey1}
        numericGroups={numericGroups}
        basis="baseline"
        title="Linha Base"
        icon={<Target className="h-3.5 w-3.5" />}
        propertiesScanned={summary.propertiesScanned}
      />
      <SummaryBox
        engine={engine}
        tasks={tasks}
        currentDate={currentDate}
        propertyKey={propKey2}
        onPropertyChange={setPropKey2}
        numericGroups={numericGroups}
        basis="forecast"
        title="Corrente"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        propertiesScanned={summary.propertiesScanned}
      />
    </div>
  );
}

interface BoxProps {
  engine: ViewerEngine | null;
  tasks: TaskWithLinks[];
  currentDate: Date | null;
  propertyKey: string;
  onPropertyChange: (key: string) => void;
  numericGroups: PropertyGroup[];
  basis: Basis;
  title: string;
  icon: React.ReactNode;
  propertiesScanned: boolean;
}

function SummaryBox({
  engine,
  tasks,
  currentDate,
  propertyKey,
  onPropertyChange,
  numericGroups,
  basis,
  title,
  icon,
  propertiesScanned,
}: BoxProps) {
  // Per-element numeric value for the selected property. The engine rebuilds
  // this from its in-memory index, so the lookup is instantaneous once the
  // property scan has completed.
  const quantityByGid = useMemo(() => {
    if (!engine || propertyKey === NONE_VALUE) return new Map<string, number>();
    return engine.getQuantityForProperty(propertyKey);
  }, [engine, propertyKey]);

  const { realized, total, unitHint } = useMemo(() => {
    if (quantityByGid.size === 0 || tasks.length === 0) {
      return { realized: 0, total: 0, unitHint: inferUnitFromKey(propertyKey) };
    }
    // Each globalId represents one physical element. If several tasks link
    // to the same element we keep the *largest* progress across those
    // tasks — that way re-linking a wall in a "finishing" task doesn't
    // undo the fact that its "structure" task already finished building it.
    const progressByGid = new Map<string, number>();
    for (const t of tasks) {
      const p = currentDate ? progressForTask(t, currentDate, basis) : 0;
      if (p === 0) continue;
      for (const gid of t.ifc_global_ids) {
        const prev = progressByGid.get(gid) ?? 0;
        if (p > prev) progressByGid.set(gid, p);
      }
    }

    let realized = 0;
    let total = 0;
    for (const [gid, value] of quantityByGid.entries()) {
      total += value;
      const p = progressByGid.get(gid) ?? 0;
      if (p > 0) realized += value * p;
    }
    return {
      realized,
      total,
      unitHint: inferUnitFromKey(propertyKey),
    };
  }, [quantityByGid, tasks, currentDate, basis, propertyKey]);

  const percent = total > 0 ? (realized / total) * 100 : 0;
  const selectedGroup =
    numericGroups.find((g) => g.key === propertyKey) ?? null;

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      <Select value={propertyKey} onValueChange={onPropertyChange}>
        <SelectTrigger className="mt-1 h-7 w-full text-[11px]">
          <SelectValue
            placeholder={
              propertiesScanned ? "Escolher quantidade" : "Escaneando…"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <div className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Modelagem
            </div>
            <SelectItem value={NONE_VALUE}>— Nenhuma —</SelectItem>
            {numericGroups.length === 0 ? (
              <SelectItem value="__empty__" disabled>
                {propertiesScanned
                  ? "Nenhuma propriedade numérica"
                  : "Escaneando…"}
              </SelectItem>
            ) : (
              numericGroups.map((g) => (
                <SelectItem key={g.key} value={g.key}>
                  <span className="font-medium">{g.propName}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    · {g.psetName}
                  </span>
                </SelectItem>
              ))
            )}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="mt-1 flex items-baseline gap-1">
        <Package className="h-3 w-3 shrink-0 text-primary" />
        <span className="truncate font-mono text-base font-semibold leading-none tabular-nums">
          {formatNumber(realized)}
        </span>
        {unitHint && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {unitHint}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {percent.toFixed(0)}%
        </span>
      </div>

      {total > 0 && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          de {formatNumber(total)}
          {unitHint ? ` ${unitHint}` : ""}
        </div>
      )}

      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/60">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            basis === "baseline" ? "bg-primary" : "bg-amber-500"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>

      {!selectedGroup && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">
          Selecione uma propriedade.
        </div>
      )}
    </div>
  );
}

/**
 * Linear completion ratio of the task at the given date.
 *   0 → hasn't started yet
 *   1 → finished (we clamp so the accumulated curve is monotonic)
 *   else → linear interpolation between start and end
 *
 * This matches the heuristic we use for the schedule stats and keeps the
 * curve smooth, which reads better on the KPI than a step function.
 */
function progressForTask(
  task: TaskWithLinks,
  current: Date,
  basis: Basis
): number {
  const startStr = basis === "baseline" ? task.baseline_start : task.start_date;
  const endStr = basis === "baseline" ? task.baseline_end : task.end_date;
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  const t = current.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (t <= start) return 0;
  if (t >= end || end <= start) return 1;
  return (t - start) / (end - start);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 0,
    }).format(n);
  }
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Best-effort unit label from the IFC property name. We don't read the real
 * IfcUnit tree yet — that's a rabbit hole — so this just pattern-matches the
 * most common names so the UI doesn't show "5.23" with no unit next to it.
 */
function inferUnitFromKey(key: string): string {
  if (key === NONE_VALUE || !key) return "";
  const lower = key.toLowerCase();
  if (lower.includes("volume")) return "m³";
  if (lower.includes("area") || lower.includes("área")) return "m²";
  if (lower.includes("length") || lower.includes("comprimento")) return "m";
  if (lower.includes("width") || lower.includes("largura")) return "m";
  if (lower.includes("height") || lower.includes("altura")) return "m";
  if (lower.includes("perimeter")) return "m";
  if (lower.includes("weight") || lower.includes("mass")) return "kg";
  if (lower.includes("count") || lower.includes("quantidade")) return "un";
  return "";
}
