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
 * Sends the IFC to /api/ifc/upload/:projectId, which pushes it to a private
 * GitHub release. This bypasses Supabase Storage's 50 MB per-file cap — the
 * PAT lives only on the server, so the browser never sees it.
 */
export function IfcUploader({ projectId, hasIfc }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);
    try {
      const form = new FormData();
      form.append("file", file, file.name);

      // We use XHR (not fetch) because it's the only way in the browser to
      // track upload progress. Large IFCs can take a while; the user deserves
      // to see a percentage.
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
            let msg = `Upload failed (${xhr.status})`;
            try {
              const body = JSON.parse(xhr.responseText) as { error?: string };
              if (body.error) msg = body.error;
            } catch {
              // not JSON — keep the generic message
            }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(form);
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
