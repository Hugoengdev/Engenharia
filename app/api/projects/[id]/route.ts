import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteProjectRelease } from "@/lib/storage/github";
import type { ProjectRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * DELETE /api/projects/:id
 *
 * Order of operations matters — we want an idempotent, "best effort" delete:
 *
 *   1. Look up the project row.
 *   2. Delete external storage (Supabase object OR GitHub release). If either
 *      of these fails, we log and keep going: the DB row is the source of
 *      truth for what the app cares about.
 *   3. Delete the `projects` row. `ON DELETE CASCADE` takes care of
 *      `schedules → tasks → task_elements` in one shot.
 *
 * Returns 404 if the project id doesn't exist (already gone — treat as success
 * from the user's perspective? Here we return 404 so the UI can distinguish).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data, error: fetchErr } = await supabase
      .from("projects")
      .select("id, ifc_storage, ifc_path")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const project = data as Pick<ProjectRow, "id" | "ifc_storage" | "ifc_path">;

    // Wipe the IFC from whichever storage it lives in. We swallow failures
    // here because the DB delete below is what actually "makes the project
    // gone" for the user.
    if (project.ifc_storage === "github") {
      try {
        await deleteProjectRelease(project.id);
      } catch (err) {
        console.warn(
          `[delete-project] GitHub release cleanup failed for ${project.id}:`,
          err
        );
      }
    } else if (project.ifc_path) {
      const { error: rmErr } = await supabase.storage
        .from("ifc-files")
        .remove([project.ifc_path]);
      if (rmErr) {
        console.warn(
          `[delete-project] Supabase object remove failed for ${project.id}:`,
          rmErr.message
        );
      }
    }

    const { error: delErr } = await supabase
      .from("projects")
      .delete()
      .eq("id", project.id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
