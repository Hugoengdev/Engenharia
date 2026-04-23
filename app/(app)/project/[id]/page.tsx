import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectWorkspace } from "@/components/app/ProjectWorkspace";
import { adaptTasks } from "@/lib/schedule/adaptTasks";
import { IfcUploader } from "@/components/app/IfcUploader";
import { fetchAllRows } from "@/lib/supabase/pagination";
import type {
  ProjectRow,
  ScheduleRow,
  TaskRow,
  TaskElementRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: projectData, error: projectErr } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (projectErr || !projectData) notFound();
  const project = projectData as ProjectRow;

  const { data: schedules } = await supabase
    .from("schedules")
    .select("*")
    .eq("project_id", project.id)
    .order("imported_at", { ascending: false })
    .limit(1);
  const schedule = (schedules?.[0] ?? null) as ScheduleRow | null;

  let tasks: TaskRow[] = [];
  let links: TaskElementRow[] = [];
  if (schedule) {
    // Page through BOTH queries — PostgREST caps `.select()` at 1000 rows
    // by default, which silently truncates real-world schedules with
    // thousands of activities (and their link rows). `fetchAllRows` loops
    // 1000-row pages until the server returns a partial page.
    const [tRows, lRows] = await Promise.all([
      fetchAllRows<TaskRow>((from, to) =>
        supabase
          .from("tasks")
          .select("*")
          .eq("schedule_id", schedule.id)
          .order("sort_order", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<TaskElementRow>((from, to) =>
        supabase
          .from("task_elements")
          .select("*, tasks!inner(schedule_id)")
          .eq("tasks.schedule_id", schedule.id)
          .range(from, to)
      ),
    ]);
    tasks = tRows;
    links = lRows.map((l) => ({
      task_id: l.task_id,
      ifc_global_id: l.ifc_global_id,
    }));
  }

  // Resolve the IFC URL based on where the file actually lives.
  //   - ifc_storage === 'github': go through our authenticated proxy; the PAT
  //     stays server-side. The viewer just fetches a plain /api/... URL.
  //   - ifc_storage === 'supabase' (legacy): use a signed URL from Storage.
  //   - neither: no IFC has been uploaded yet.
  let ifcSignedUrl: string | null = null;
  const hasIfc = project.ifc_storage === "github" || !!project.ifc_path;
  if (project.ifc_storage === "github" && project.ifc_asset_id) {
    // Cache-bust with the asset id so browser cache invalidates after an
    // IFC re-upload (new asset id → new URL).
    ifcSignedUrl = `/api/ifc/download/${project.id}?v=${project.ifc_asset_id}`;
  } else if (project.ifc_path) {
    const { data: signed } = await supabase.storage
      .from("ifc-files")
      .createSignedUrl(project.ifc_path, 60 * 60);
    ifcSignedUrl = signed?.signedUrl ?? null;
  }

  if (!hasIfc) {
    return (
      <div className="container max-w-4xl py-12">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        {project.description && (
          <p className="mt-2 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <div className="mt-10 rounded-xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
          <h3 className="text-base font-semibold">Faça upload do IFC</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Envie seu arquivo IFC 2x3 ou IFC 4 para começar. Em seguida você
            poderá importar o cronograma e gerar a simulação 4D.
          </p>
          <div className="mt-6 inline-flex">
            <IfcUploader projectId={project.id} hasIfc={false} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProjectWorkspace
      project={project}
      scheduleId={schedule?.id ?? null}
      initialStatusDate={schedule?.status_date ?? null}
      initialTasks={adaptTasks(tasks, links)}
      ifcSignedUrl={ifcSignedUrl}
    />
  );
}
