"use client";

import { useState } from "react";
import { Loader2, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  projectId: string;
}

/**
 * One-click migration from Supabase Storage to GitHub Releases for an
 * existing project. Shown only for legacy projects (ifc_storage !== 'github').
 *
 * Task links survive this operation untouched: we re-upload the exact same
 * IFC bytes, so every IfcGUID stays the same, and `task_elements` keys by
 * those GUIDs.
 */
export function MigrateToGithubButton({ projectId }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function handle() {
    if (running) return;
    const ok = window.confirm(
      "Migrar este projeto para o GitHub Releases?\n\n" +
        "- O IFC será reenviado idêntico, os links do cronograma são preservados.\n" +
        "- A cópia antiga no Supabase será removida em seguida.\n" +
        "- Pode levar alguns minutos em arquivos grandes."
    );
    if (!ok) return;

    setRunning(true);
    const id = toast.loading("Migrando IFC para o GitHub…");
    try {
      const res = await fetch(`/api/ifc/migrate/${projectId}`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        storage?: string;
        size?: number;
        already?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Falha (${res.status})`);
      }
      if (body.already) {
        toast.success("Projeto já estava no GitHub.", { id });
      } else {
        toast.success("Migração concluída.", { id });
      }
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha na migração";
      toast.error(msg, { id });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handle}
      disabled={running}
      title="Mover o IFC do Supabase para o GitHub Releases (links preservados)"
    >
      {running ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CloudUpload className="h-3.5 w-3.5" />
      )}
      Migrar para GitHub
    </Button>
  );
}
