"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import "gantt-task-react/dist/index.css";
import {
  Plus,
  Trash2,
  Edit3,
  Maximize2,
  Minimize2,
  Calendar as CalendarIcon,
  Link2,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  taskDelayDays,
  useProjectStore,
  type TaskWithLinks,
} from "@/lib/store/projectStore";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import type { Task as GanttTaskType } from "gantt-task-react";

const Gantt = dynamic(
  () => import("gantt-task-react").then((m) => m.Gantt),
  { ssr: false, loading: () => <GanttSkeleton /> }
);

function GanttSkeleton() {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground">
      Carregando Gantt...
    </div>
  );
}

// ---------- date helpers ----------
const MS_DAY = 1000 * 60 * 60 * 24;

function daysBetween(startIso: string, endIso: string): number {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return Math.max(1, Math.round((e - s) / MS_DAY));
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

// ---------- props ----------
interface Props {
  scheduleId: string | null;
  onCreateSchedule: () => Promise<string>;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
}

// Column widths. Two date pairs: forecast (tendência) and baseline (linha
// de base). 4D uses baseline; color compares to forecast.
// The "Atividade" (name) column is fluid (`minmax(min, 1fr)`) so the grid
// always fills the container — no dead space on the right when the schedule
// panel is wider than the sum of the fixed columns.
const COL_ID = 40;
// "Local" mirrors the spreadsheet column users import (e.g. "FT02 - OAES01").
// Sized to comfortably fit those codes without squeezing the Atividade column.
const COL_LOCATION = 110;
const COL_NAME_MIN = 170;
const COL_DURATION = 54;
const COL_START = 68;
const COL_END = 68;
const COL_BASE_START = 68;
const COL_BASE_END = 68;
const COL_ACTIONS = 32;
// LIST_WIDTH is the *minimum* width the list needs — used when the Gantt
// library wants a fixed number for `listCellWidth`. The actual render grows
// the Name column beyond this whenever extra horizontal room is available.
const LIST_WIDTH =
  COL_ID +
  COL_LOCATION +
  COL_NAME_MIN +
  COL_DURATION +
  COL_START +
  COL_END +
  COL_BASE_START +
  COL_BASE_END +
  COL_ACTIONS;
const GRID_TEMPLATE = `${COL_ID}px ${COL_LOCATION}px minmax(${COL_NAME_MIN}px, 1fr) ${COL_DURATION}px ${COL_START}px ${COL_END}px ${COL_BASE_START}px ${COL_BASE_END}px ${COL_ACTIONS}px`;

// gantt-task-react default headerHeight. We bumped it a bit to give room to
// the "Tendência" / "Linha de base" group labels above the date columns.
const HEADER_H = 60;

// ---------- sorting ----------
export type SortColumn =
  | "id"
  | "location"
  | "name"
  | "duration"
  | "start"
  | "end"
  | "baseline_start"
  | "baseline_end";
export type SortDirection = "asc" | "desc";
export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

function compareTasks(
  a: TaskWithLinks,
  b: TaskWithLinks,
  column: SortColumn
): number {
  switch (column) {
    case "id":
      return a.sort_order - b.sort_order;
    case "location":
      // Rows with no Local sink to the bottom so the grouped rows from the
      // same Local stay contiguous at the top of each direction.
      return (a.location ?? "\uffff").localeCompare(
        b.location ?? "\uffff",
        "pt-BR",
        { sensitivity: "base" }
      );
    case "name":
      return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    case "duration":
      return (
        daysBetween(a.start_date, a.end_date) -
        daysBetween(b.start_date, b.end_date)
      );
    case "start":
      return (
        new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
      );
    case "end":
      return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
    case "baseline_start":
      return (
        new Date(a.baseline_start).getTime() -
        new Date(b.baseline_start).getTime()
      );
    case "baseline_end":
      return (
        new Date(a.baseline_end).getTime() -
        new Date(b.baseline_end).getTime()
      );
  }
}

export function GanttEditor({
  scheduleId,
  onCreateSchedule,
  onToggleMaximize,
  isMaximized,
}: Props) {
  const tasks = useProjectStore((s) => s.tasks);
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId);
  const setSelectedTask = useProjectStore((s) => s.setSelectedTask);
  const upsertTask = useProjectStore((s) => s.upsertTask);
  const removeTask = useProjectStore((s) => s.removeTask);

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({
    column: "id",
    direction: "asc",
  });

  const toggleSort = useCallback((column: SortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? {
            column,
            direction: prev.direction === "asc" ? "desc" : "asc",
          }
        : { column, direction: "asc" }
    );
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ganttHeight, setGanttHeight] = useState(400);

  // Measure container height so gantt-task-react scrolls internally and keeps
  // the horizontal scrollbar pinned at the bottom. ganttHeight is the height
  // of the body (it does NOT include the calendar header), so we subtract
  // HEADER_H plus a small margin for safety.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight - HEADER_H - 8;
      if (h > 100) setGanttHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMaximized]);

  // Stable ID (1-based, based on sort_order) per task. Doesn't change when
  // the user re-sorts the table by another column.
  const stableIdById = useMemo(() => {
    const sortedByOrder = [...tasks].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    const map = new Map<string, number>();
    sortedByOrder.forEach((t, i) => map.set(t.id, i + 1));
    return map;
  }, [tasks]);

  // Task list ordered by current sort state.
  const orderedTasks = useMemo(() => {
    const arr = [...tasks];
    arr.sort((a, b) => compareTasks(a, b, sort.column));
    if (sort.direction === "desc") arr.reverse();
    return arr;
  }, [tasks, sort]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const ganttTasks: GanttTaskType[] = useMemo(() => {
    return orderedTasks.map((t, i) => ({
      id: t.id,
      name: t.name,
      start: new Date(t.start_date),
      end: new Date(t.end_date),
      progress: t.progress,
      type: "task",
      isDisabled: true, // disable drag / progress editing on the bar
      displayOrder: i,
      styles: t.color
        ? { progressColor: t.color, backgroundColor: t.color + "60" }
        : undefined,
    } satisfies GanttTaskType));
  }, [orderedTasks]);

  async function handleDelete() {
    if (!selectedTaskId) return;
    const orig = tasks.find((t) => t.id === selectedTaskId);
    if (!orig) return;
    if (!confirm(`Excluir a tarefa "${orig.name}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", orig.id);
    if (error) {
      toast.error("Erro ao excluir");
      return;
    }
    removeTask(orig.id);
    setSelectedTask(null);
    toast.success("Tarefa excluída");
  }

  // Custom list table — closes over our richer data.
  const TaskListTable: React.FC<{
    rowHeight: number;
    rowWidth: string;
    fontFamily: string;
    fontSize: string;
    locale: string;
    tasks: GanttTaskType[];
    selectedTaskId: string;
    setSelectedTask: (id: string) => void;
    onExpanderClick: (task: GanttTaskType) => void;
  }> = useCallback(
    (props) => (
      <TaskListBody
        {...props}
        originalTasks={tasks}
        stableIdById={stableIdById}
        onEdit={(id) => setEditingId(id)}
      />
    ),
    [tasks, stableIdById]
  );

  // Custom header — closes over sort state.
  const TaskListHeaderComponent: React.FC<{
    headerHeight: number;
    rowWidth: string;
    fontFamily: string;
    fontSize: string;
  }> = useCallback(
    (props) => (
      <TaskListHeader {...props} sort={sort} onToggleSort={toggleSort} />
    ),
    [sort, toggleSort]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-card/60 px-4 py-2.5">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            Cronograma
          </h3>
          <span className="text-[11px] font-medium text-muted-foreground">
            {tasks.length}{" "}
            {tasks.length === 1 ? "tarefa" : "tarefas"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedTask}
            onClick={() => selectedTaskId && setEditingId(selectedTaskId)}
          >
            <Edit3 className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedTask}
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Excluir
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            Nova tarefa
          </Button>
          {onToggleMaximize && (
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={onToggleMaximize}
              title={isMaximized ? "Restaurar layout" : "Maximizar cronograma"}
            >
              {isMaximized ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden bg-background/40"
        style={{ colorScheme: "dark" }}
      >
        {tasks.length === 0 ? (
          <EmptyGantt onCreate={() => setCreating(true)} />
        ) : isMaximized ? (
          // Full Gantt (list + chart) only when the panel is maximized.
          <Gantt
            tasks={ganttTasks}
            listCellWidth={`${LIST_WIDTH}px`}
            columnWidth={48}
            rowHeight={36}
            headerHeight={HEADER_H}
            barCornerRadius={4}
            fontSize="12"
            ganttHeight={ganttHeight}
            barProgressColor="#38bdf8"
            barProgressSelectedColor="#7dd3fc"
            barBackgroundColor="#475569"
            barBackgroundSelectedColor="#64748b"
            projectProgressColor="#60a5fa"
            projectProgressSelectedColor="#93c5fd"
            projectBackgroundColor="#1e40af"
            projectBackgroundSelectedColor="#2563eb"
            arrowColor="#64748b"
            todayColor="rgba(56, 189, 248, 0.08)"
            onSelect={(t, isSelected) =>
              setSelectedTask(isSelected ? t.id : null)
            }
            onDoubleClick={(t) => setEditingId(t.id)}
            TaskListHeader={TaskListHeaderComponent}
            TaskListTable={TaskListTable}
          />
        ) : (
          // List-only mode: no Gantt bars, so the panel stays narrow and the
          // 3D viewer keeps its full width. Maximize to see the full Gantt.
          <StandaloneTaskList
            tasks={orderedTasks}
            ganttTasks={ganttTasks}
            selectedTaskId={selectedTaskId ?? ""}
            setSelectedTask={(id) => setSelectedTask(id || null)}
            stableIdById={stableIdById}
            onEdit={(id) => setEditingId(id)}
            sort={sort}
            onToggleSort={toggleSort}
          />
        )}
      </div>

      <NewTaskDialog
        open={creating}
        onOpenChange={setCreating}
        scheduleId={scheduleId}
        onCreateSchedule={onCreateSchedule}
        existingCount={tasks.length}
      />
      <EditTaskDialog
        taskId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={(updated) => upsertTask(updated)}
      />
    </div>
  );
}

// ---------- List Header ----------
interface TaskListHeaderProps {
  headerHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
  sort: SortState;
  onToggleSort: (column: SortColumn) => void;
}

function TaskListHeader({
  headerHeight,
  fontFamily,
  sort,
  onToggleSort,
}: TaskListHeaderProps) {
  // Two-row header: top row groups the date pairs into "Tendência" and "Base".
  const topRowH = Math.max(18, Math.floor(headerHeight * 0.38));
  const bottomRowH = headerHeight - topRowH;

  return (
    <div
      className="select-none border-b border-r border-border/60 bg-secondary/50 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90"
      style={{ height: headerHeight, fontFamily }}
    >
      {/* Group-row: the left portion (ID+Name+Duration) is a single fluid
          span that matches the `minmax(min, 1fr)` name column below, then
          the two date pairs get soft labels, ending with an actions cell. */}
      <div
        className="grid border-b border-border/40 text-[9px]"
        style={{
          height: topRowH,
          gridTemplateColumns: `${COL_ID}px ${COL_LOCATION}px minmax(${COL_NAME_MIN}px, 1fr) ${COL_DURATION}px ${
            COL_START + COL_END
          }px ${COL_BASE_START + COL_BASE_END}px ${COL_ACTIONS}px`,
        }}
      >
        <div />
        <div />
        <div />
        <div />
        <div className="flex items-center justify-center border-l border-border/40 text-primary/80">
          Tendência
        </div>
        <div className="flex items-center justify-center border-l border-border/40 text-muted-foreground/80">
          Linha de base
        </div>
        <div />
      </div>

      <div
        className="grid items-stretch"
        style={{
          height: bottomRowH,
          gridTemplateColumns: GRID_TEMPLATE,
        }}
      >
        <SortHeaderCell
          label="ID"
          column="id"
          align="center"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Local"
          column="location"
          align="start"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Atividade"
          column="name"
          align="start"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Duração"
          column="duration"
          align="end"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Início"
          column="start"
          align="end"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Fim"
          column="end"
          align="end"
          sort={sort}
          onToggle={onToggleSort}
        />
        <SortHeaderCell
          label="Início"
          column="baseline_start"
          align="end"
          sort={sort}
          onToggle={onToggleSort}
          muted
        />
        <SortHeaderCell
          label="Fim"
          column="baseline_end"
          align="end"
          sort={sort}
          onToggle={onToggleSort}
          muted
        />
        <div aria-hidden />
      </div>
    </div>
  );
}

function SortHeaderCell({
  label,
  column,
  align,
  sort,
  onToggle,
  muted = false,
}: {
  label: string;
  column: SortColumn;
  align: "start" | "center" | "end";
  sort: SortState;
  onToggle: (column: SortColumn) => void;
  muted?: boolean;
}) {
  const active = sort.column === column;
  const justify =
    align === "center"
      ? "justify-center"
      : align === "end"
        ? "justify-end"
        : "justify-start";
  const baseColor = muted
    ? "text-muted-foreground/70"
    : "text-inherit";
  return (
    <button
      type="button"
      onClick={() => onToggle(column)}
      title={`Ordenar por ${label}${muted ? " (linha de base)" : ""}`}
      className={`group flex h-full w-full items-center gap-1 px-2 ${baseColor} transition-colors hover:text-foreground ${justify} ${
        active ? "text-foreground" : ""
      }`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        sort.direction === "asc" ? (
          <ArrowUp className="h-3 w-3 text-primary" />
        ) : (
          <ArrowDown className="h-3 w-3 text-primary" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-70" />
      )}
    </button>
  );
}

// ---------- List Body ----------
interface TaskListBodyProps {
  rowHeight: number;
  tasks: GanttTaskType[];
  selectedTaskId: string;
  setSelectedTask: (id: string) => void;
  originalTasks: TaskWithLinks[];
  stableIdById: Map<string, number>;
  onEdit: (id: string) => void;
}

function TaskListBody({
  rowHeight,
  tasks,
  selectedTaskId,
  setSelectedTask,
  originalTasks,
  stableIdById,
  onEdit,
}: TaskListBodyProps) {
  const byId = useMemo(
    () => new Map(originalTasks.map((t) => [t.id, t])),
    [originalTasks]
  );

  return (
    <div className="border-r border-border/60">
      {tasks.map((t) => {
        const full = byId.get(t.id);
        if (!full) return null;
        const isSelected = selectedTaskId === t.id;
        const linked = full.ifc_global_ids.length;
        const stableId = stableIdById.get(t.id) ?? 0;

        return (
          <div
            key={t.id}
            className={`group relative grid cursor-pointer items-center border-b border-border/20 text-[12px] transition-colors ${
              isSelected
                ? "bg-primary/10 text-foreground"
                : "hover:bg-secondary/30"
            }`}
            style={{
              height: rowHeight,
              gridTemplateColumns: GRID_TEMPLATE,
            }}
            onClick={() => setSelectedTask(t.id)}
            onDoubleClick={() => onEdit(t.id)}
          >
            {isSelected && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[2px] bg-primary"
              />
            )}
            <div className="flex items-center justify-center">
              <span
                className={`inline-flex min-w-[24px] items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums tracking-tight ${
                  isSelected
                    ? "bg-primary/20 text-primary"
                    : "bg-secondary/60 text-muted-foreground"
                }`}
              >
                {stableId}
              </span>
            </div>
            <div
              className="min-w-0 truncate px-2 text-[11px] text-muted-foreground/90"
              title={full.location ?? ""}
            >
              {full.location ?? (
                <span className="text-muted-foreground/40">—</span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2 px-3">
              <DelayDot task={full} />
              <span
                className="min-w-0 truncate font-medium text-foreground/95"
                title={t.name}
              >
                {t.name}
              </span>
              {linked > 0 && (
                <span
                  title={`${linked} elemento(s) 3D linkados`}
                  className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {linked}
                </span>
              )}
            </div>
            <div className="px-3 text-right font-mono text-[11px] tabular-nums text-foreground/80">
              {daysBetween(full.start_date, full.end_date)}
              <span className="ml-0.5 text-muted-foreground">d</span>
            </div>
            <div className="px-2 text-right font-mono text-[11px] tabular-nums text-foreground/85">
              {shortDate(full.start_date)}
            </div>
            <div className="px-2 text-right font-mono text-[11px] tabular-nums text-foreground/85">
              {shortDate(full.end_date)}
            </div>
            <div
              className="px-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground/75"
              title={`Base: ${shortDate(full.baseline_start)}`}
            >
              {shortDate(full.baseline_start)}
            </div>
            <div
              className={`px-2 text-right font-mono text-[11px] tabular-nums ${
                new Date(full.end_date) > new Date(full.baseline_end)
                  ? "text-red-400/90"
                  : new Date(full.end_date) < new Date(full.baseline_end)
                    ? "text-green-400/90"
                    : "text-muted-foreground/75"
              }`}
              title={`Base: ${shortDate(full.baseline_end)}`}
            >
              {shortDate(full.baseline_end)}
            </div>
            <div className="flex justify-center pr-2">
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-secondary/80 hover:text-foreground group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(t.id);
                }}
                title="Editar tarefa"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Standalone (list-only) view ----------
// Used when the schedule panel is NOT maximized: shows just the columns with
// no Gantt chart beside them, so the 3D viewer keeps its full width.
interface StandaloneTaskListProps {
  tasks: TaskWithLinks[];
  ganttTasks: GanttTaskType[];
  selectedTaskId: string;
  setSelectedTask: (id: string) => void;
  stableIdById: Map<string, number>;
  onEdit: (id: string) => void;
  sort: SortState;
  onToggleSort: (column: SortColumn) => void;
}

function StandaloneTaskList({
  tasks,
  ganttTasks,
  selectedTaskId,
  setSelectedTask,
  stableIdById,
  onEdit,
  sort,
  onToggleSort,
}: StandaloneTaskListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskListHeader
        headerHeight={HEADER_H}
        rowWidth=""
        fontFamily="inherit"
        fontSize="12"
        sort={sort}
        onToggleSort={onToggleSort}
      />
      <div
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: "stable" }}
      >
        <TaskListBody
          rowHeight={36}
          tasks={ganttTasks}
          selectedTaskId={selectedTaskId}
          setSelectedTask={setSelectedTask}
          originalTasks={tasks}
          stableIdById={stableIdById}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}

// ---------- Delay indicator ----------
function DelayDot({ task }: { task: TaskWithLinks }) {
  const delay = taskDelayDays(task);
  let color: string;
  let label: string;
  if (delay > 0) {
    color = "bg-red-500";
    label = `Atrasada ${delay}d vs linha de base`;
  } else if (delay < 0) {
    color = "bg-green-500";
    label = `Antecipada ${Math.abs(delay)}d vs linha de base`;
  } else {
    color = "bg-muted-foreground/30";
    label = "No prazo da linha de base";
  }
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`}
    />
  );
}

// ---------- Empty state ----------
function EmptyGantt({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="grid h-full min-h-[300px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10">
          <CalendarIcon className="h-6 w-6 text-primary" />
        </div>
        <h3 className="mt-4 text-base font-semibold">Sem tarefas ainda</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Importe um cronograma (MS Project, P6, CSV ou Excel) ou crie a
          primeira tarefa manualmente.
        </p>
        <Button className="mt-4" size="sm" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" />
          Nova tarefa
        </Button>
      </div>
    </div>
  );
}

// ---------- New Task Dialog ----------
interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scheduleId: string | null;
  onCreateSchedule: () => Promise<string>;
  existingCount: number;
}

function NewTaskDialog({
  open,
  onOpenChange,
  scheduleId,
  onCreateSchedule,
  existingCount,
}: NewTaskDialogProps) {
  const upsertTask = useProjectStore((s) => s.upsertTask);
  const [name, setName] = useState("");
  const [start, setStart] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [end, setEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      let sid = scheduleId;
      if (!sid) sid = await onCreateSchedule();

      const supabase = createClient();
      // New tasks always start on-plan → baseline = forecast.
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          schedule_id: sid,
          name: name.trim(),
          start_date: start,
          end_date: end,
          baseline_start: start,
          baseline_end: end,
          progress: 0,
          sort_order: existingCount,
          predecessors: [],
          parent_id: null,
        })
        .select("*")
        .single();
      if (error) throw error;

      upsertTask({
        ...data,
        ifc_global_ids: [],
      } as TaskWithLinks);
      toast.success("Tarefa criada");
      setName("");
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao criar tarefa";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">Nome</Label>
            <Input
              id="task-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Concretagem dos pilares P1"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-start">Início</Label>
              <Input
                id="task-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-end">Fim</Label>
              <Input
                id="task-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {start && end && new Date(end) >= new Date(start) ? (
              <>
                Duração:{" "}
                {daysBetween(start, end)} dias · de {formatDate(start)} até{" "}
                {formatDate(end)}
              </>
            ) : (
              "Defina datas válidas (fim ≥ início)"
            )}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                loading || !name.trim() || new Date(end) < new Date(start)
              }
            >
              {loading ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Edit Task Dialog ----------
interface EditTaskDialogProps {
  taskId: string | null;
  onClose: () => void;
  onSaved: (task: TaskWithLinks) => void;
}

function EditTaskDialog({ taskId, onClose, onSaved }: EditTaskDialogProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const open = taskId !== null;
  const originalTask = useMemo(
    () => tasks.find((t) => t.id === taskId) ?? null,
    [tasks, taskId]
  );

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [baselineStart, setBaselineStart] = useState("");
  const [baselineEnd, setBaselineEnd] = useState("");
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!originalTask) return;
    setName(originalTask.name);
    setLocation(originalTask.location ?? "");
    setStart(originalTask.start_date);
    setEnd(originalTask.end_date);
    setBaselineStart(originalTask.baseline_start);
    setBaselineEnd(originalTask.baseline_end);
    setProgress(originalTask.progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalTask?.id]);

  if (!open || !originalTask) return null;

  const delayDays =
    baselineEnd && end
      ? Math.round(
          (new Date(end).getTime() - new Date(baselineEnd).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 0;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!originalTask) return;
    if (new Date(end) < new Date(start)) {
      toast.error("A data de fim precisa ser ≥ início");
      return;
    }
    if (new Date(baselineEnd) < new Date(baselineStart)) {
      toast.error("A linha de base: fim precisa ser ≥ início");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const trimmedLocation = location.trim();
      const update = {
        name: name.trim() || originalTask.name,
        // Empty string → null so the column keeps its "sem local" semantics
        // (rendered as a dash in the list and ignored by the sort tail).
        location: trimmedLocation === "" ? null : trimmedLocation,
        start_date: start,
        end_date: end,
        baseline_start: baselineStart,
        baseline_end: baselineEnd,
        progress,
      };
      const { error } = await supabase
        .from("tasks")
        .update(update)
        .eq("id", originalTask.id);
      if (error) throw error;
      onSaved({
        ...originalTask,
        ...update,
      } as TaskWithLinks);
      toast.success("Tarefa atualizada");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao salvar";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function copyForecastToBaseline() {
    setBaselineStart(start);
    setBaselineEnd(end);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar tarefa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nome</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-location">Local</Label>
              <Input
                id="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex.: FT02 - OAES01"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tendência (cronograma atual)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-start">Início</Label>
                <Input
                  id="edit-start"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end">Fim</Label>
                <Input
                  id="edit-end"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-progress">Progresso (%)</Label>
                <Input
                  id="edit-progress"
                  type="number"
                  min={0}
                  max={100}
                  value={progress}
                  onChange={(e) =>
                    setProgress(
                      Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-secondary/20 p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Linha de base (baseline)
              </div>
              <button
                type="button"
                onClick={copyForecastToBaseline}
                className="text-[11px] text-primary hover:underline"
              >
                Copiar tendência
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-baseline-start">Início base</Label>
                <Input
                  id="edit-baseline-start"
                  type="date"
                  value={baselineStart}
                  onChange={(e) => setBaselineStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-baseline-end">Fim base</Label>
                <Input
                  id="edit-baseline-end"
                  type="date"
                  value={baselineEnd}
                  onChange={(e) => setBaselineEnd(e.target.value)}
                  required
                />
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              A modelagem 4D roda sobre a linha de base. Se o fim previsto
              passar do fim da base, o elemento aparece em{" "}
              <span className="font-semibold text-red-400">vermelho</span>;
              caso contrário, em{" "}
              <span className="font-semibold text-green-400">verde</span>.
            </p>
            {delayDays !== 0 && (
              <div
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  delayDays > 0
                    ? "bg-red-500/15 text-red-400"
                    : "bg-green-500/15 text-green-400"
                }`}
              >
                {delayDays > 0
                  ? `Atraso projetado: ${delayDays}d`
                  : `Antecipação: ${Math.abs(delayDays)}d`}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
