import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ensureProjectRelease,
  uploadAssetToRelease,
  byteLengthOf,
} from "@/lib/storage/github";

// Node runtime (not Edge). Uploads can be large (hundreds of MB) and we need
// Node's Buffer/stream support. 60s is the ceiling on Vercel's Hobby plan;
// on Pro this can safely go up to 300s (5 min) for very large IFC uploads.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/ifc/upload/:projectId
 *
 * Body: multipart/form-data with a single field `file` — the IFC.
 *
 * Flow:
 *   1. Read the blob from the request (runs on our server; the PAT stays server-side).
 *   2. Make sure the per-project release exists on GitHub (tag: project-<id>).
 *   3. Upload the blob as an asset on that release. Replaces any existing asset
 *      with the same name (i.e. re-uploading overwrites).
 *   4. Update the `projects` row so the viewer knows to fetch from GitHub and
 *      forget the Supabase copy.
 *
 * Existing `task_elements` links are preserved automatically: they reference
 * IFC GlobalIDs, which are baked into the file itself — the storage backend
 * makes no difference to them.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing `file` field (multipart/form-data)" },
        { status: 400 }
      );
    }

    const filename =
      ("name" in file && typeof (file as File).name === "string"
        ? (file as File).name
        : "model.ifc") || "model.ifc";

    // We store the asset under a predictable name so the download route never
    // has to guess. The original user-chosen name is kept in the DB for UI.
    const assetName = "model.ifc";
    const contentType = "application/octet-stream";

    const release = await ensureProjectRelease(projectId);
    const asset = await uploadAssetToRelease({
      release,
      filename: assetName,
      contentType,
      body: file,
      contentLength: byteLengthOf(file),
    });

    const supabase = await createClient();
    const { error: updErr } = await supabase
      .from("projects")
      .update({
        ifc_storage: "github",
        ifc_release_id: release.id,
        ifc_asset_id: asset.id,
        ifc_asset_name: assetName,
        ifc_filename: filename,
        ifc_size_bytes: asset.size,
        // Clear the Supabase path so nobody tries to resolve it any more.
        ifc_path: null,
      })
      .eq("id", projectId);
    if (updErr) {
      return NextResponse.json(
        { error: `Upload succeeded but DB update failed: ${updErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      filename,
      size: asset.size,
      storage: "github",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
