"use client";

import { useEffect, useState } from "react";
import { Upload, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IfcViewer } from "@/components/viewer/IfcViewer";
import { GanttEditor } from "@/components/gantt/GanttEditor";
import { TimelinePlayer } from "@/components/timeline/TimelinePlayer";
import { TaskElementLinker } from "@/components/linker/TaskElementLinker";
import { ImportScheduleDialog } from "@/components/schedule/ImportScheduleDialog";
import { MigrateToGithubButton } from "@/components/app/MigrateToGithubButton";
import { QuantitySummaryBoxes } from "@/components/summary/QuantitySummaryBoxes";
import {
  useProjectStore,
  type TaskWithLinks,
} from "@/lib/store/projectStore";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { ProjectRow } from "@/lib/supabase/types";
import type { ViewerEngine, ElementInfo } from "@/lib/ifc/viewerEngine";
import type { ImportResult } from "@/lib/schedule/types";

type MaximizedPanel = "viewer" | "schedule" | null;

interface Props {
  project: ProjectRow;
  scheduleId: string | null;
  initialStatusDate: string | null;
  initialTasks: TaskWithLinks[];
  ifcSignedUrl: string | null;
}

export function ProjectWorkspace({
  project,
  scheduleId: initialScheduleId,
  initialStatusDate,
  initialTasks,
  ifcSignedUrl,
}: Props) {
  const setProjectMeta = useProjectStore((s) => s.setProjectMeta);
  const setTasks = useProjectStore((s) => s.setTasks);
  const setStatusDate = useProjectStore((s) => s.setStatusDate);
  const setSelectedGlobalIds = useProjectStore((s) => s.setSelectedGlobalIds);
  const [scheduleId, setScheduleId] = useState(initialScheduleId);
  const [importOpen, setImportOpen] = useState(false);
  const [engine, setEngine] = useState<ViewerEngine | null>(null);
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null
  );
  const [maximized, setMaximized] = useState<MaximizedPanel>(null);

  function toggleMaximize(panel: Exclude<MaximizedPanel, null>) {
    setMaximized((prev) => (prev === panel ? null : panel));
  }

  useEffect(() => {
    setProjectMeta(project.id, scheduleId);
    setTasks(initialTasks);
    setStatusDate(
      initialStatusDate ? new Date(`${initialStatusDate}T00:00:00`) : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function ensureSchedule(
    sourceType: ImportResult["source_type"] = "manual"
  ): Promise<string> {
    if (scheduleId) return scheduleId;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("schedules")
      .insert({ project_id: project.id, source_type: sourceType })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Não foi possível criar o cronograma");
      throw error ?? new Error("Falha ao criar schedule");
    }
    setScheduleId(data.id);
    return data.id;
  }

  async function replaceSchedule(
    sourceType: ImportResult["source_type"]
  ): Promise<string> {
    const supabase = createClient();
    // Carry the current status date across re-imports — it reflects the
    // user's reporting choice, not anything in the schedule file.
    let preservedStatusDate: string | null = null;
    if (scheduleId) {
      const { data: prev } = await supabase
        .from("schedules")
        .select("status_date")
        .eq("id", scheduleId)
        .maybeSingle();
      preservedStatusDate = (prev?.status_date as string | null) ?? null;
      await supabase.from("schedules").delete().eq("id", scheduleId);
      setScheduleId(null);
    }
    const { data, error } = await supabase
      .from("schedules")
      .insert({
        project_id: project.id,
        source_type: sourceType,
        status_date: preservedStatusDate,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("Falha ao criar schedule");
    setScheduleId(data.id);
    return data.id;
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-card/40 px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{project.name}</div>
          {project.ifc_filename && (
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {project.ifc_filename}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {project.ifc_storage !== "github" && project.ifc_path && (
            <MigrateToGithubButton projectId={project.id} />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            Importar cronograma
          </Button>
        </div>
      </div>

      {/* Two-row workspace:
          - TOP row owns the 3D viewer on the left and the right panel
            (quantity KPIs + linker) on a narrow column. Neither is tied
            to the schedule, so the viewer keeps its original width and
            the linker is never stretched to accommodate the Gantt.
          - BOTTOM row gives the Gantt its own full-width strip (so all
            its columns fit without dead space on the right) with the
            timeline tucked to its left at a fixed compact width.
          Maximize toggles collapse one of the rows entirely. */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-2">
        {maximized !== "schedule" && (
          <div className="flex min-h-0 flex-1 gap-2">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card/40">
              <IfcViewer
                ifcUrl={ifcSignedUrl}
                onSelect={setSelectedElement}
                onSelectionChange={setSelectedGlobalIds}
                onReady={(e) => setEngine(e)}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => toggleMaximize("viewer")}
                title={
                  maximized === "viewer"
                    ? "Restaurar layout"
                    : "Maximizar modelagem 3D"
                }
                className="absolute left-3 top-3 z-10 h-8 w-8 bg-card/90 backdrop-blur"
              >
                {maximized === "viewer" ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            </div>
            {maximized === null && (
              <div className="flex w-[460px] shrink-0 flex-col gap-2 overflow-hidden">
                <div className="shrink-0">
                  <QuantitySummaryBoxes engine={engine} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <TaskElementLinker
                    engine={engine}
                    selectedElement={selectedElement}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom strip. Always rendered (even with the viewer maximized)
            when a schedule exists so the user can keep scrubbing the 4D
            timeline without having to restore the layout. The Gantt itself
            is hidden in that case — just the TimelinePlayer stays on. */}
        {maximized !== "schedule" && maximized === "viewer" && (
          <div className="shrink-0">
            <TimelinePlayer engine={engine} />
          </div>
        )}
        {maximized !== "viewer" && (
          <div
            className={`flex min-h-0 gap-2 ${
              maximized === "schedule" ? "flex-1" : "h-[42%] shrink-0"
            }`}
          >
            {maximized === null && (
              <div className="w-[400px] shrink-0 overflow-hidden">
                <TimelinePlayer engine={engine} />
              </div>
            )}
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-card/40">
              <GanttEditor
                scheduleId={scheduleId}
                onCreateSchedule={() => ensureSchedule("manual")}
                onToggleMaximize={() => toggleMaximize("schedule")}
                isMaximized={maximized === "schedule"}
              />
            </div>
          </div>
        )}
      </div>

      <ImportScheduleDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        scheduleId={scheduleId}
        onCreateSchedule={replaceSchedule}
      />
    </div>
  );
}

// Helper used by server page when no tasks present
