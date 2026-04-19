import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ensureProjectRelease,
  uploadAssetToRelease,
} from "@/lib/storage/github";

export const runtime = "nodejs";
export const maxDuration = 60; // 60s is ceiling on Vercel Hobby

/**
 * POST /api/ifc/stream-upload/:projectId
 *
 * Reliable chunked upload that works around Vercel's limits and serverless
 * statelessness by using Supabase Storage as a temporary staging area.
 * 
 * Flow:
 *   1. Client sends chunks of ~2 MB (well under Vercel's 4.5 MB limit).
 *   2. Server saves each chunk to the "ifc-files" bucket in Supabase 
 *      (e.g., `staging/{projectId}/{uploadId}/chunk-0`).
 *      This solves the /tmp stateless issue on Vercel.
 *   3. On the final chunk, the server downloads all chunks from Supabase,
 *      stitches them together in memory (Vercel has 1024 MB RAM), and
 *      uploads the full buffer to GitHub Releases as a single stream.
 *   4. Clean up the staging chunks from Supabase.
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

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("owner_id")
      .eq("id", projectId)
      .maybeSingle();
    
    if (projErr || !project || project.owner_id !== user.id) {
      return NextResponse.json(
        { error: "Projeto não encontrado ou sem permissão" },
        { status: 403 }
      );
    }

    const uploadId = req.headers.get("X-Upload-Id") || req.headers.get("x-upload-id");
    const chunkIndexStr = req.headers.get("X-Chunk-Index") || req.headers.get("x-chunk-index");
    const totalChunksStr = req.headers.get("X-Total-Chunks") || req.headers.get("x-total-chunks");
    const filename = req.headers.get("X-Filename") || req.headers.get("x-filename") || "model.ifc";

    if (!uploadId || chunkIndexStr == null || totalChunksStr == null) {
      return NextResponse.json(
        { error: "Headers obrigatórios: X-Upload-Id, X-Chunk-Index, X-Total-Chunks" },
        { status: 400 }
      );
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);

    if (
      isNaN(chunkIndex) ||
      isNaN(totalChunks) ||
      chunkIndex < 0 ||
      totalChunks < 1 ||
      chunkIndex >= totalChunks
    ) {
      return NextResponse.json({ error: "Valores inválidos de chunk" }, { status: 400 });
    }

    const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeUploadId) {
      return NextResponse.json({ error: "Upload ID inválido" }, { status: 400 });
    }

    // --- Read the chunk ---
    const bodyBuffer = await req.arrayBuffer();
    if (bodyBuffer.byteLength === 0) {
      return NextResponse.json({ error: "Chunk vazio" }, { status: 400 });
    }

    // --- Save chunk to Supabase Storage ---
    const chunkPath = `staging/${projectId}/${safeUploadId}/chunk-${String(chunkIndex).padStart(5, "0")}`;
    
    const { error: uploadErr } = await supabase.storage
      .from("ifc-files")
      .upload(chunkPath, bodyBuffer, { upsert: true, contentType: "application/octet-stream" });

    if (uploadErr) {
      console.error("[stream-upload] error uploading chunk to supabase:", uploadErr);
      return NextResponse.json(
        { error: "Falha ao salvar o chunk temporário" },
        { status: 500 }
      );
    }

    // --- Check if this is the last chunk ---
    if (chunkIndex < totalChunks - 1) {
      return NextResponse.json({
        ok: true,
        chunk: chunkIndex,
        totalChunks,
        status: "chunk_received",
      });
    }

    // --- LAST CHUNK: Assembly & Upload to GitHub ---
    console.log(`[stream-upload] assembling ${totalChunks} chunks for project ${projectId}...`);
    
    const buffers: Buffer[] = [];
    const cleanupPaths: string[] = [];

    for (let i = 0; i < totalChunks; i++) {
        const p = `staging/${projectId}/${safeUploadId}/chunk-${String(i).padStart(5, "0")}`;
        cleanupPaths.push(p);

        const { data: fileData, error: downloadErr } = await supabase.storage
            .from("ifc-files")
            .download(p);
        
        if (downloadErr || !fileData) {
            return NextResponse.json(
                { error: `Chunk ${i} não encontrado (pode ter havido timeout). Tente novamente.` },
                { status: 500 }
            );
        }

        const b = Buffer.from(await fileData.arrayBuffer());
        buffers.push(b);
    }

    const fullBuffer = Buffer.concat(buffers);
    console.log(`[stream-upload] assembly complete. total size: ${(fullBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

    // --- Upload to GitHub Releases ---
    const assetName = "model.ifc";
    let release;
    try {
        release = await ensureProjectRelease(projectId);
    } catch (e: any) {
        return NextResponse.json({ error: `Erro ao preparar GitHub Release: ${e.message}` }, { status: 500 });
    }

    let asset;
    try {
        asset = await uploadAssetToRelease({
        release,
        filename: assetName,
        contentType: "application/octet-stream",
        body: fullBuffer,
        contentLength: fullBuffer.byteLength,
        });
    } catch (e: any) {
        return NextResponse.json({ error: `Erro ao enviar para GitHub: ${e.message}` }, { status: 500 });
    }

    // --- Update Database ---
    const { error: updErr } = await supabase
      .from("projects")
      .update({
        ifc_storage: "github",
        ifc_release_id: release.id,
        ifc_asset_id: asset.id,
        ifc_asset_name: assetName,
        ifc_filename: filename,
        ifc_size_bytes: asset.size,
        ifc_path: null,
      })
      .eq("id", projectId);

    if (updErr) {
      return NextResponse.json(
        { error: `Upload OK mas falha no banco: ${updErr.message}` },
        { status: 500 }
      );
    }

    // --- Cleanup Supabase Staging Chunks ---
    supabase.storage.from("ifc-files").remove(cleanupPaths).then((res) => {
        if (res.error) console.warn("[stream-upload] cleanup failed:", res.error);
    });

    return NextResponse.json({
      ok: true,
      filename,
      size: asset.size,
      storage: "github",
      status: "complete",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
