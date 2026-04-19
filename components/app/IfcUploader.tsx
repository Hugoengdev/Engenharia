"use client";

import { useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

interface Props {
  projectId: string;
  hasIfc: boolean;
}

/**
 * Uploads IFC files directly to GitHub Releases via an Edge Runtime API route.
 *
 * The Edge Runtime route (`/api/ifc/stream-upload/:projectId`) has NO body
 * size limit — unlike Vercel Serverless Functions (~4.5 MB). This means we
 * can send files of any size without needing Vercel Blob as a staging area.
 *
 * Flow:  Browser  →  Edge Route (stream-upload)  →  GitHub Releases
 */
export function IfcUploader({ projectId, hasIfc }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);
    try {
      // Use XMLHttpRequest to track upload progress (fetch() doesn't support it).
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/ifc/stream-upload/${projectId}`);

        // Send as raw binary with metadata in headers.
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-Filename", file.name);

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            let msg = `Upload falhou (${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText) as { error?: string };
              if (body.error) msg = body.error;
            } catch {
              /* not JSON */
            }
            reject(new Error(msg));
          }
        };

        xhr.onerror = () => reject(new Error("Erro de rede durante o upload"));
        xhr.send(file);
      });

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
