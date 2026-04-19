"use client";

import { useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

interface Props {
  projectId: string;
  hasIfc: boolean;
}

/** Vercel Serverless request body limit — direct POST to our API above this fails with 413. */
const VERCEL_SAFE_DIRECT_BYTES = 4_500_000;

function stagingPathname(projectId: string): string {
  return `ifc-staging/${projectId}/model.ifc`;
}

/**
 * IFC uploads go to GitHub Releases (server PAT). Bodies cannot pass through
 * Next.js on Vercel beyond ~4.5 MB (413). When `BLOB_READ_WRITE_TOKEN` is set,
 * we stage via Vercel Blob (browser → Blob → server stream → GitHub), not
 * Supabase Storage — so models can exceed 50 MB.
 */
export function IfcUploader({ projectId, hasIfc }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function uploadViaBlobThenGithub(file: File) {
    const pathname = stagingPathname(projectId);
    const blobResult = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/ifc/blob-client",
      clientPayload: JSON.stringify({ projectId }),
      contentType: "application/octet-stream",
      multipart: file.size >= 8 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => {
        setProgress(Math.min(88, Math.round(percentage * 0.88)));
      },
    });

    setProgress(92);
    const commitRes = await fetch(`/api/ifc/commit-blob/${projectId}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: blobResult.url,
        pathname: blobResult.pathname,
        filename: file.name,
      }),
    });
    if (!commitRes.ok) {
      let msg = `Falha ao publicar no GitHub (${commitRes.status})`;
      try {
        const body = (await commitRes.json()) as { error?: string };
        if (body.error) msg = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    setProgress(100);
  }

  async function uploadViaDirectApi(file: File) {
    const form = new FormData();
    form.append("file", file, file.name);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/ifc/upload/${projectId}`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let msg =
            xhr.status === 413
              ? "413: o pedido excede o limite do hosting. Em produção na Vercel defina BLOB_READ_WRITE_TOKEN (Blob) para enviar IFCs grandes."
              : `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* not JSON */
          }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(form);
    });
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);
    try {
      const capRes = await fetch("/api/ifc/staging", { credentials: "same-origin" });
      const cap = (await capRes.json()) as { blobConfigured?: boolean };
      const blobOk = Boolean(cap.blobConfigured);

      if (blobOk) {
        await uploadViaBlobThenGithub(file);
      } else if (file.size <= VERCEL_SAFE_DIRECT_BYTES) {
        await uploadViaDirectApi(file);
      } else {
        throw new Error(
          "Ficheiros IFC grandes precisam de Vercel Blob: crie um store em vercel.com/storage, copie BLOB_READ_WRITE_TOKEN para as variáveis de ambiente do projeto e faça redeploy. (O limite de ~4,5 MB no corpo do pedido impede o envio direto para a API na Vercel.)"
        );
      }

      toast.success(`${file.name} enviado (${formatBytes(file.size)})`);
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha no upload";
      toast.error(msg);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <div>
      <input
        id="ifc-upload"
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUpload(f);
        }}
        disabled={uploading}
      />
      <Button
        size="sm"
        variant={hasIfc ? "outline" : "default"}
        asChild
        disabled={uploading}
      >
        <label htmlFor="ifc-upload" className="cursor-pointer">
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {hasIfc ? "Substituir IFC" : "Upload IFC"}
          {progress !== null && <span className="ml-1">{progress}%</span>}
        </label>
      </Button>
    </div>
  );
}
