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
 * Maximum bytes per chunk. Must be well under Vercel's ~4.5 MB serverless
 * function body limit. We use 3.5 MB to leave ample headroom.
 */
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

/** Generate a random upload session ID. */
function newUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads IFC files to GitHub Releases via chunked API route.
 *
 * Files are split into chunks of ~3.5 MB and sent sequentially to
 * `/api/ifc/stream-upload/:projectId`. Each chunk is saved to /tmp on
 * the server. The last chunk triggers assembly + GitHub upload.
 *
 * This bypasses Vercel's 4.5 MB body limit without requiring Vercel Blob
 * or any paid service.
 */
export function IfcUploader({ projectId, hasIfc }: Props) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);

    try {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const uploadId = newUploadId();

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const res = await fetch(`/api/ifc/stream-upload/${projectId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Id": uploadId,
            "X-Chunk-Index": String(i),
            "X-Total-Chunks": String(totalChunks),
            "X-Filename": file.name,
          },
          body: chunk,
        });

        if (!res.ok) {
          let msg = `Upload falhou (${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* not JSON */
          }
          throw new Error(msg);
        }

        // Progress: each chunk contributes equally
        const pct = Math.round(((i + 1) / totalChunks) * 100);
        setProgress(pct);
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
