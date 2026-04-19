import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Edge Runtime — no 4.5 MB body size limit! Streams passam direto.
 *
 * We can't use `import "server-only"` here because it breaks Edge Runtime,
 * but this route only runs server-side anyway.
 */
export const runtime = "edge";

const GH_API = "https://api.github.com";
const GH_UPLOADS = "https://uploads.github.com";

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

function ghAuth(token: string): Record<string, string> {
  return { ...GH_HEADERS, Authorization: `Bearer ${token}` };
}

function getGithubConfig() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) {
    throw new Error("GitHub storage não configurado — defina GITHUB_OWNER, GITHUB_REPO e GITHUB_TOKEN.");
  }
  return { owner, repo, token };
}

/**
 * POST /api/ifc/stream-upload/:projectId
 *
 * Aceita o IFC como corpo binário puro (application/octet-stream). O browser
 * envia fetch(url, { method: 'POST', body: file, headers: { 'Content-Type':
 * 'application/octet-stream', 'X-Filename': 'nome.ifc' } }).
 *
 * Como roda em Edge Runtime, não há limite de ~4.5 MB. A request body é lida
 * como ArrayBuffer e reenviada ao GitHub Releases upload endpoint.
 *
 * Fluxo:
 *   1. Verifica autenticação e que o usuário é dono do projeto.
 *   2. Garante que a release GitHub do projeto existe (cria se necessário).
 *   3. Remove asset anterior com o mesmo nome se existir.
 *   4. Faz upload do binário direto ao GitHub Releases.
 *   5. Atualiza o registro no Supabase.
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

    // --- Auth check ---
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
      return NextResponse.json({ error: "Projeto não encontrado ou sem permissão" }, { status: 403 });
    }

    // --- Read the binary body ---
    // Edge Runtime: reading the full body as ArrayBuffer is fine — there's no
    // Serverless body-size limit. GitHub requires Content-Length anyway,
    // so we need the full size upfront.
    const bodyBuffer = await req.arrayBuffer();
    if (bodyBuffer.byteLength === 0) {
      return NextResponse.json({ error: "Body vazio" }, { status: 400 });
    }

    const displayFilename =
      req.headers.get("X-Filename") || req.headers.get("x-filename") || "model.ifc";
    const assetName = "model.ifc";

    // --- GitHub: ensure release exists ---
    const gh = getGithubConfig();
    const tag = `project-${projectId}`;

    let release = await getRelease(gh, tag);
    if (!release) {
      release = await createRelease(gh, tag, projectId);
    }

    // Remove any prior asset with the same name.
    const stale = release.assets.find((a: any) => a.name === assetName);
    if (stale) {
      await deleteAsset(gh, stale.id);
    }

    // --- Upload to GitHub ---
    const uploadUrl = new URL(
      `${GH_UPLOADS}/repos/${gh.owner}/${gh.repo}/releases/${release.id}/assets`
    );
    uploadUrl.searchParams.set("name", assetName);

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        ...ghAuth(gh.token),
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bodyBuffer.byteLength),
      },
      body: bodyBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => "");
      return NextResponse.json(
        { error: `GitHub upload falhou (${uploadRes.status}): ${errText}` },
        { status: 502 }
      );
    }

    const asset = (await uploadRes.json()) as { id: number; size: number; name: string };

    // --- Update Supabase ---
    const { error: updErr } = await supabase
      .from("projects")
      .update({
        ifc_storage: "github",
        ifc_release_id: release.id,
        ifc_asset_id: asset.id,
        ifc_asset_name: assetName,
        ifc_filename: displayFilename,
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

    return NextResponse.json({
      ok: true,
      filename: displayFilename,
      size: asset.size,
      storage: "github",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Inline GitHub helpers (Edge-compatible, no `server-only` import) ────

async function getRelease(
  gh: { owner: string; repo: string; token: string },
  tag: string
) {
  const res = await fetch(
    `${GH_API}/repos/${gh.owner}/${gh.repo}/releases/tags/${encodeURIComponent(tag)}`,
    { method: "GET", headers: ghAuth(gh.token), cache: "no-store" }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch release ${tag}: ${res.status}`);
  }
  return (await res.json()) as any;
}

async function createRelease(
  gh: { owner: string; repo: string; token: string },
  tag: string,
  projectId: string
) {
  const res = await fetch(`${GH_API}/repos/${gh.owner}/${gh.repo}/releases`, {
    method: "POST",
    headers: { ...ghAuth(gh.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `Project ${projectId}`,
      body: `IFC storage for project ${projectId}. Managed automatically.`,
      draft: false,
      prerelease: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create release ${tag}: ${res.status}`);
  }
  return (await res.json()) as any;
}

async function deleteAsset(
  gh: { owner: string; repo: string; token: string },
  assetId: number
) {
  const res = await fetch(
    `${GH_API}/repos/${gh.owner}/${gh.repo}/releases/assets/${assetId}`,
    { method: "DELETE", headers: ghAuth(gh.token) }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete asset ${assetId}: ${res.status}`);
  }
}
