import { del, get, head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ensureProjectRelease,
  uploadAssetToRelease,
} from "@/lib/storage/github";

export const runtime = "nodejs";
/** Large models: GitHub + Blob copy can exceed Hobby 60s — tune on Vercel dashboard. */
export const maxDuration = 300;

const STAGING_PREFIX = "ifc-staging";

function expectedPathname(projectId: string): string {
  return `${STAGING_PREFIX}/${projectId}/model.ifc`;
}

type CommitBody = {
  url: string;
  pathname: string;
  filename?: string;
};

/**
 * POST /api/ifc/commit-blob/:projectId
 *
 * After the browser finishes a client-side Blob upload, this route streams the
 * staging object to GitHub Releases (PAT stays server-side), updates `projects`,
 * and deletes the temporary blob.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN não configurado" },
      { status: 503 }
    );
  }

  try {
    const { projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    let json: CommitBody;
    try {
      json = (await req.json()) as CommitBody;
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const { url, pathname, filename } = json;
    if (!url || typeof url !== "string" || !pathname || typeof pathname !== "string") {
      return NextResponse.json(
        { error: "Campos `url` e `pathname` são obrigatórios" },
        { status: 400 }
      );
    }

    const expected = expectedPathname(projectId);
    if (pathname !== expected) {
      return NextResponse.json({ error: "Pathname inválido" }, { status: 403 });
    }

    const meta = await head(url);
    if (!meta || meta.pathname !== expected) {
      return NextResponse.json(
        { error: "Blob de staging não encontrado ou expirado" },
        { status: 404 }
      );
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
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }

    const blobGet = await get(url, { access: "private", useCache: false });
    if (!blobGet || blobGet.statusCode !== 200 || !blobGet.stream) {
      return NextResponse.json(
        { error: "Não foi possível ler o blob de staging" },
        { status: 502 }
      );
    }

    const contentLength = blobGet.blob.size;
    const assetName = "model.ifc";
    const displayName =
      typeof filename === "string" && filename.trim().length > 0
        ? filename.trim()
        : "model.ifc";

    const release = await ensureProjectRelease(projectId);
    const asset = await uploadAssetToRelease({
      release,
      filename: assetName,
      contentType: "application/octet-stream",
      body: blobGet.stream,
      contentLength,
    });

    const { error: updErr } = await supabase
      .from("projects")
      .update({
        ifc_storage: "github",
        ifc_release_id: release.id,
        ifc_asset_id: asset.id,
        ifc_asset_name: assetName,
        ifc_filename: displayName,
        ifc_size_bytes: asset.size,
        ifc_path: null,
      })
      .eq("id", projectId);
    if (updErr) {
      return NextResponse.json(
        { error: `GitHub OK mas falha na base de dados: ${updErr.message}` },
        { status: 500 }
      );
    }

    try {
      await del(url);
    } catch (e) {
      console.warn("[commit-blob] falha ao apagar staging blob:", e);
    }

    return NextResponse.json({
      ok: true,
      filename: displayName,
      size: asset.size,
      storage: "github",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
