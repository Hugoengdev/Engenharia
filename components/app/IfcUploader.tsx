"use client";

import { useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface Props {
  projectId: string;
  hasIfc: boolean;
}

/** Same order of magnitude as Supabase free-tier file limits (see migrations). */
const STAGED_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * IFC upload flow:
 *
 *   1. **Staged (default for files ≤ 50 MB)** — the browser uploads directly to
 *      the private `ifc-files` bucket (path `{owner_id}/{project_id}/model.ifc`),
 *      then updates the `projects` row and calls `POST /api/ifc/migrate/:id` so
 *      the server copies bytes to GitHub with the PAT. This avoids sending the
 *      whole model through Next.js / Vercel, where request bodies are capped at
 *      ~4.5 MB and trigger HTTP 413.
 *
 *   2. **Direct (files > 50 MB)** — legacy `POST /api/ifc/upload/:id` with XHR
 *      progress. Works on self-hosted Node (raise reverse-proxy limits); on
 *      Vercel it will still fail with 413 until a different transport exists.
 */
export function IfcUploader({ projectId, hasIfc }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function uploadViaStaging(file: File) {
    const supabase = createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      throw new Error("Sessão inválida. Inicie sessão novamente.");
    }

    const storagePath = `${user.id}/${projectId}/model.ifc`;

    setProgress(8);
    const { error: upErr } = await supabase.storage
      .from("ifc-files")
      .upload(storagePath, file, {
        upsert: true,
        contentType: "application/octet-stream",
        cacheControl: "3600",
      });
    if (upErr) {
      throw new Error(
        upErr.message ||
          "Não foi possível enviar o ficheiro para o armazenamento."
      );
    }

    setProgress(35);
    const { error: dbErr } = await supabase
      .from("projects")
      .update({
        ifc_path: storagePath,
        ifc_storage: "supabase",
        ifc_filename: file.name,
        ifc_size_bytes: file.size,
        ifc_release_id: null,
        ifc_asset_id: null,
        ifc_asset_name: null,
      })
      .eq("id", projectId);
    if (dbErr) {
      throw new Error(dbErr.message || "Não foi possível atualizar o projeto.");
    }

    setProgress(55);
    const migRes = await fetch(`/api/ifc/migrate/${projectId}`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!migRes.ok) {
      let msg = `Falha ao publicar o modelo (${migRes.status})`;
      try {
        const body = (await migRes.json()) as { error?: string };
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
              ? "O servidor rejeitou o ficheiro por ser demasiado grande (limite do hosting). Para ficheiros até 50 MB use o envio em duas fases; acima disso é necessário alojamento que aceite pedidos grandes."
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
      if (file.size <= STAGED_UPLOAD_MAX_BYTES) {
        await uploadViaStaging(file);
      } else {
        await uploadViaDirectApi(file);
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
