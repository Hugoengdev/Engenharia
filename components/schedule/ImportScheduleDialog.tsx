"use client";

import { useState } from "react";
import { Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  importScheduleFile,
  listXlsxSheets,
  parseXlsxSheet,
} from "@/lib/schedule/importers";
import type { ImportResult } from "@/lib/schedule/types";
import {
  matchTasksByStableId,
  preservedLinksFromMatches,
} from "@/lib/schedule/preserveLinks";
import {
  useProjectStore,
  type TaskWithLinks,
} from "@/lib/store/projectStore";
import { createClient } from "@/lib/supabase/client";
import { chunkedInsert, fetchAllRows } from "@/lib/supabase/pagination";
import type { TaskRow, TaskElementRow } from "@/lib/supabase/types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scheduleId: string | null;
  onCreateSchedule: (
    sourceType: ImportResult["source_type"]
  ) => Promise<string>;
}

export function ImportScheduleDialog({
  open,
  onOpenChange,
  scheduleId,
  onCreateSchedule,
}: Props) {
  const setTasks = useProjectStore((s) => s.setTasks);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  // When the user picks an .xlsx we don't parse immediately — we first read
  // the workbook, list the sheets and ask which one to import. The raw
  // buffer is kept so the parse uses the exact same bytes the user picked.
  const [xlsxBuffer, setXlsxBuffer] = useState<ArrayBuffer | null>(null);
  const [xlsxSheets, setXlsxSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");

  function resetXlsxState() {
    setXlsxBuffer(null);
    setXlsxSheets([]);
    setSelectedSheet("");
  }

  async function handlePick(f: File | undefined | null) {
    setError(null);
    setParsed(null);
    resetXlsxState();
    if (!f) return;
    setFile(f);

    const isXlsx =
      f.name.toLowerCase().endsWith(".xlsx") ||
      f.name.toLowerCase().endsWith(".xls");

    try {
      if (isXlsx) {
        const buffer = await f.arrayBuffer();
        const sheets = listXlsxSheets(buffer);
        if (sheets.length === 0) {
          throw new Error("Planilha sem abas");
        }
        setXlsxBuffer(buffer);
        setXlsxSheets(sheets);
        setSelectedSheet(sheets[0]);
        // Don't parse yet — wait for the user to confirm the sheet.
        return;
      }
      const result = await importScheduleFile(f);
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ler arquivo");
    }
  }

  function handleParseSheet(sheetName: string) {
    setError(null);
    setParsed(null);
    if (!xlsxBuffer) return;
    try {
      const result = parseXlsxSheet(xlsxBuffer, sheetName);
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ler aba");
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    setLoading(true);
    try {
      const supabase = createClient();

      // 1) Before replacing, snapshot the old schedule so we can preserve
      //    task → IFC element links by a stable identifier (external_id →
      //    wbs → sort_order → name).
      let oldTasks: TaskRow[] = [];
      let oldLinks: TaskElementRow[] = [];
      if (replace && scheduleId) {
        // Both queries need paging: schedules with >1000 tasks would only
        // have the first 1000 matched against, silently dropping 3D links
        // for the rest on re-import.
        const [tRows, lRows] = await Promise.all([
          fetchAllRows<TaskRow>((from, to) =>
            supabase
              .from("tasks")
              .select("*")
              .eq("schedule_id", scheduleId)
              .range(from, to)
          ),
          fetchAllRows<TaskElementRow>((from, to) =>
            supabase
              .from("task_elements")
              .select("task_id, ifc_global_id, tasks!inner(schedule_id)")
              .eq("tasks.schedule_id", scheduleId)
              .range(from, to)
          ),
        ]);
        oldTasks = tRows;
        oldLinks = lRows.map((l) => ({
          task_id: l.task_id,
          ifc_global_id: l.ifc_global_id,
        }));
      }

      // 2) Match new tasks to old tasks by stable ID so we can preserve
      //    both links (task_elements) AND baseline dates across re-imports.
      //    Baselines only travel via explicit user edits, never via the file.
      const matches =
        replace && oldTasks.length > 0
          ? matchTasksByStableId(
              oldTasks.map((t) => ({
                id: t.id,
                external_id: t.external_id,
                sort_order: t.sort_order,
                baseline_start: t.baseline_start,
                baseline_end: t.baseline_end,
              })),
              parsed.tasks
            )
          : parsed.tasks.map(() => null);

      // 3) Create the new (or reuse existing) schedule. When replacing, the
      //    parent's `onCreateSchedule` deletes the old one, which cascades
      //    tasks + task_elements.
      let sid = scheduleId;
      if (!sid || replace) {
        sid = await onCreateSchedule(parsed.source_type);
      }

      // 4) Insert the new tasks. Baseline priority:
      //    (a) the file itself — if the spreadsheet / XER / XML has its
      //        own "linha base / baseline" columns, they always win, so
      //        the user sees in the app exactly what they planned.
      //    (b) the matched old task's baseline — for re-imports where the
      //        file doesn't carry baselines (kept so edits aren't lost).
      //    (c) the forecast start/end — only as a last resort for brand
      //        new tasks, so the 4D doesn't flag them as "delayed" on
      //        day 1.
      const rows = parsed.tasks.map((t, i) => {
        const old = matches[i];
        return {
          schedule_id: sid!,
          external_id: t.external_id,
          wbs: t.wbs,
          location: t.location,
          name: t.name,
          start_date: t.start_date,
          end_date: t.end_date,
          baseline_start:
            t.baseline_start ?? old?.baseline_start ?? t.start_date,
          baseline_end: t.baseline_end ?? old?.baseline_end ?? t.end_date,
          duration_days: t.duration_days,
          progress: t.progress,
          predecessors: t.predecessors,
          sort_order: t.sort_order,
        };
      });

      // Chunked insert: for very large schedules a single insert can hit
      // PostgREST's body size limit and/or time out. 500 rows per chunk is
      // conservative and fits inside Vercel's serverless limits.
      const insertedRows = await chunkedInsert<(typeof rows)[number], TaskRow>(
        async (slice) => {
          const res = await supabase.from("tasks").insert(slice).select("*");
          return { data: res.data as TaskRow[] | null, error: res.error };
        },
        rows,
        500
      );

      // 5) Use the same matches to recover ifc_global_ids.
      const preserved = preservedLinksFromMatches(matches, oldLinks);

      // Reorder `preserved` to match `insertedRows` order (the DB may return
      // rows in a different order than we inserted).
      const insertedByKey = new Map<string, TaskRow>();
      for (const r of insertedRows) {
        insertedByKey.set(`${r.sort_order}::${r.name}`, r);
      }

      const preservedByNewTaskId = new Map<string, string[]>();
      parsed.tasks.forEach((nt, i) => {
        const row = insertedByKey.get(`${nt.sort_order}::${nt.name}`);
        if (row) preservedByNewTaskId.set(row.id, preserved[i]);
      });

      // 6) Persist the preserved links.
      const elementRows: { task_id: string; ifc_global_id: string }[] = [];
      for (const [taskId, gids] of preservedByNewTaskId.entries()) {
        for (const gid of gids) {
          elementRows.push({ task_id: taskId, ifc_global_id: gid });
        }
      }
      if (elementRows.length > 0) {
        // Same chunking rationale as the tasks insert — large schedules
        // can have thousands of preserved 3D links.
        await chunkedInsert<(typeof elementRows)[number], { task_id: string }>(
          async (slice) => {
            const res = await supabase
              .from("task_elements")
              .insert(slice)
              .select("task_id");
            return {
              data: res.data as { task_id: string }[] | null,
              error: res.error,
            };
          },
          elementRows,
          1000
        );
      }

      // 7) Update the store with the new tasks + their preserved links.
      const hydrated: TaskWithLinks[] = insertedRows.map((t) => ({
        ...t,
        ifc_global_ids: preservedByNewTaskId.get(t.id) ?? [],
      }));
      setTasks(hydrated);

      const linkedTasksCount = hydrated.filter(
        (t) => t.ifc_global_ids.length > 0
      ).length;
      toast.success(
        `${rows.length} tarefa(s) importada(s)${
          linkedTasksCount > 0
            ? ` · ${linkedTasksCount} com links 3D preservados`
            : ""
        }`
      );
      onOpenChange(false);
      setFile(null);
      setParsed(null);
      resetXlsxState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao importar";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar cronograma</DialogTitle>
          <DialogDescription>
            Aceita MS Project XML, Primavera P6 (XML/XER), CSV e Excel
            (.xlsx). Para .mpp, exporte como XML no MS Project.
            <br />
            <span className="mt-2 block text-xs">
              Colunas esperadas no Excel:{" "}
              <span className="font-mono text-foreground">
                ID · Local · Atividade · Inicio · Fim · Inicio BL · Fim BL
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        <label
          htmlFor="schedule-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/30 px-6 py-10 text-center transition-colors hover:border-primary/50"
        >
          <Upload className="h-6 w-6 text-primary" />
          <span className="text-sm font-medium">
            Clique para selecionar o arquivo
          </span>
          <span className="text-xs text-muted-foreground">
            .xml · .xer · .csv · .xlsx
          </span>
          <input
            id="schedule-file"
            type="file"
            className="hidden"
            accept=".xml,.xer,.csv,.xlsx,.xls"
            onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
            disabled={loading}
          />
        </label>

        {file && (
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="font-medium">{file.name}</span>
            </div>
            {parsed && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  Origem:{" "}
                  <span className="font-mono text-foreground">
                    {parsed.source_type}
                  </span>
                </div>
                <div>
                  Tarefas:{" "}
                  <span className="font-mono text-foreground">
                    {parsed.tasks.length}
                  </span>
                </div>
              </div>
            )}
            {error && (
              <p className="mt-2 text-xs text-destructive">{error}</p>
            )}
          </div>
        )}

        {xlsxSheets.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
            <label className="text-xs font-medium text-foreground">
              Selecione a aba do Excel
            </label>
            <div className="flex gap-2">
              <Select
                value={selectedSheet}
                onValueChange={setSelectedSheet}
                disabled={loading}
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder="Escolha a aba" />
                </SelectTrigger>
                <SelectContent>
                  {xlsxSheets.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleParseSheet(selectedSheet)}
                disabled={!selectedSheet || loading}
              >
                Carregar aba
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              A aba deve conter as colunas: ID, Local, Atividade, Inicio, Fim,
              Inicio BL, Fim BL.
            </p>
          </div>
        )}

        {scheduleId && parsed && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              Substituir cronograma atual
            </label>
            {replace && (
              <p className="pl-5 text-[11px] leading-snug text-muted-foreground">
                Os links entre tarefas e elementos 3D já feitos serão
                reaproveitados quando a nova tarefa tiver o mesmo ID
                (ID externo do arquivo ou número da linha).
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!parsed || loading}>
            {loading ? "Importando..." : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
