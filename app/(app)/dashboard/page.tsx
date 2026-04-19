import Link from "next/link";
import { Plus, Box, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatBytes } from "@/lib/utils";
import { NewProjectDialog } from "@/components/app/NewProjectDialog";
import { DeleteProjectButton } from "@/components/app/DeleteProjectButton";
import type { ProjectRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  const list = (projects ?? []) as ProjectRow[];

  return (
    <div className="container max-w-6xl py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Seus projetos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize seus modelos IFC e cronogramas em um só lugar.
          </p>
        </div>
        <NewProjectDialog>
          <Button>
            <Plus className="h-4 w-4" />
            Novo projeto
          </Button>
        </NewProjectDialog>
      </div>

      {list.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  const hasIfc = project.ifc_storage === "github" || !!project.ifc_path;
  return (
    <div className="group relative">
      {/* Delete sits on top of the Link so it never triggers navigation. */}
      <DeleteProjectButton
        projectId={project.id}
        projectName={project.name}
        iconOnly
      />
      <Link
        href={`/project/${project.id}`}
        className="flex flex-col rounded-xl border border-border/60 bg-card/40 p-5 backdrop-blur transition-colors hover:border-primary/40"
      >
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-background">
            <Box className="h-5 w-5 text-primary" />
          </div>
          <span className="mr-9 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {hasIfc ? "IFC pronto" : "Sem IFC"}
          </span>
        </div>
        <h3 className="mt-5 truncate text-base font-semibold tracking-tight">
          {project.name}
        </h3>
        {project.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {project.description}
          </p>
        )}
        <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(project.updated_at)}
          </span>
          {project.ifc_size_bytes && (
            <span className="font-mono">
              {formatBytes(project.ifc_size_bytes)}
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 rounded-xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-xl bg-primary/10">
        <Box className="h-7 w-7 text-primary" />
      </div>
      <h3 className="mt-6 text-lg font-semibold">Nenhum projeto ainda</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Crie seu primeiro projeto para começar. Você poderá subir um IFC e
        importar o cronograma logo em seguida.
      </p>
      <div className="mt-6 inline-flex">
        <NewProjectDialog>
          <Button>
            <Plus className="h-4 w-4" />
            Criar primeiro projeto
          </Button>
        </NewProjectDialog>
      </div>
    </div>
  );
}
