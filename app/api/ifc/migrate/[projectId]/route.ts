import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ensureProjectRelease,
  uploadAssetToRelease,
  byteLengthOf,
} from "@/lib/storage/github";
import type { ProjectRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
// 60s = Vercel Hobby plan ceiling. Raise up to 300 on Pro if needed.
export const maxDuration = 60;

/**
 * POST /api/ifc/migrate/:projectId
 *
 * One-shot migration of a legacy, Supabase-hosted IFC to GitHub Releases.
 *
 *   1. Download the file from the `ifc-files` Storage bucket.
 *   2. Upload the exact same bytes to the project's GitHub release.
 *   3. Flip `ifc_storage` to `'github'` on the row and clear `ifc_path`.
 *   4. Delete the old copy from Supabase Storage to free the 1 GB quota.
 *
 * Since we re-upload the IFC byte-for-byte, every IfcGUID inside is preserved
 * — and `task_elements` keys links by those GUIDs. So the schedule ↔ 3D
 * linkage remains valid without touching any other table.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("projects")
      .select("id, ifc_path, ifc_filename, ifc_size_bytes, ifc_storage")
      .eq("id", projectId)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    const project = data as Pick<
      ProjectRow,
      "id" | "ifc_path" | "ifc_filename" | "ifc_size_bytes" | "ifc_storage"
    >;

    if (project.ifc_storage === "github") {
      return NextResponse.json(
        { ok: true, already: true, storage: "github" },
        { status: 200 }
      );
    }
    if (!project.ifc_path) {
      return NextResponse.json(
        { error: "Project has no IFC to migrate" },
        { status: 400 }
      );
    }

    const dl = await supabase.storage
      .from("ifc-files")
      .download(project.ifc_path);
    if (dl.error || !dl.data) {
      return NextResponse.json(
        {
          error: `Failed to read IFC from Supabase: ${
            dl.error?.message ?? "empty body"
          }`,
        },
        { status: 502 }
      );
    }

    // dl.data is a Blob in Node / Edge runtimes.
    const blob = dl.data;
    const assetName = "model.ifc";

    const release = await ensureProjectRelease(projectId);
    const asset = await uploadAssetToRelease({
      release,
      filename: assetName,
      contentType: "application/octet-stream",
      body: blob,
      contentLength: byteLengthOf(blob),
    });

    const { error: updErr } = await supabase
      .from("projects")
      .update({
        ifc_storage: "github",
        ifc_release_id: release.id,
        ifc_asset_id: asset.id,
        ifc_asset_name: assetName,
        ifc_size_bytes: asset.size,
        ifc_path: null,
      })
      .eq("id", projectId);
    if (updErr) {
      return NextResponse.json(
        {
          error: `Migration uploaded to GitHub but DB update failed: ${updErr.message}. Please re-run.`,
        },
        { status: 500 }
      );
    }

    // Now that the DB points to GitHub, the Supabase copy is redundant.
    // Deletion failure is non-fatal — the row no longer references it.
    const rm = await supabase.storage
      .from("ifc-files")
      .remove([project.ifc_path]);
    if (rm.error) {
      console.warn(
        `[migrate] failed to delete old Supabase object ${project.ifc_path}: ${rm.error.message}`
      );
    }

    return NextResponse.json({
      ok: true,
      storage: "github",
      size: asset.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
