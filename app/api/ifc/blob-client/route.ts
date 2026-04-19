import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const STAGING_PREFIX = "ifc-staging";
/** GitHub release assets allow up to 2 GB; stay slightly under for headroom. */
const MAX_IFC_BYTES = Math.floor(1.9 * 1024 * 1024 * 1024);

function stagingPathname(projectId: string): string {
  return `${STAGING_PREFIX}/${projectId}/model.ifc`;
}

/**
 * POST /api/ifc/blob-client
 *
 * Vercel Blob `handleUpload` bridge: issues short-lived client tokens so the
 * browser can upload large IFCs without hitting the ~4.5 MB Serverless request
 * body limit, then `/api/ifc/commit-blob/:projectId` streams bytes to GitHub.
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Vercel Blob não está configurado. Crie um store em vercel.com/storage, adicione BLOB_READ_WRITE_TOKEN ao projeto e volte a tentar.",
      },
      { status: 503 }
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let projectId: string;
        try {
          const parsed = JSON.parse(clientPayload ?? "{}") as {
            projectId?: string;
          };
          projectId = parsed.projectId ?? "";
        } catch {
          throw new Error("Payload inválido");
        }

        const expected = stagingPathname(projectId);
        if (!projectId || pathname !== expected) {
          throw new Error("Caminho de upload não autorizado");
        }

        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          throw new Error("Não autenticado");
        }

        const { data: project, error } = await supabase
          .from("projects")
          .select("owner_id")
          .eq("id", projectId)
          .maybeSingle();
        if (error || !project || project.owner_id !== user.id) {
          throw new Error("Projeto inválido ou sem permissão");
        }

        return {
          allowedContentTypes: [
            "application/octet-stream",
            "text/plain",
            "model/ifc",
            "*/*",
          ],
          maximumSizeInBytes: MAX_IFC_BYTES,
          allowOverwrite: true,
          addRandomSuffix: false,
          tokenPayload: clientPayload,
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no token Blob";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
