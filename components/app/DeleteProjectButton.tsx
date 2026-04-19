"use client";

import { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  projectId: string;
  projectName: string;
  /**
   * If true (dashboard card), the trigger is a tiny icon button positioned
   * absolutely over the card. If false, it's a regular outlined button that
   * fits inline (e.g. project header).
   */
  iconOnly?: boolean;
  /**
   * Where to go after deletion. Defaults to refreshing the current page (good
   * for the dashboard). Pass "/dashboard" when called from inside a project
   * page so the user isn't stranded on a 404.
   */
  redirectTo?: string;
}

export function DeleteProjectButton({
  projectId,
  projectName,
  iconOnly,
  redirectTo,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [running, setRunning] = useState(false);

  // Require the user to type the project name verbatim. This is the nuclear
  // option — no soft-delete, no undo, all cronograma + links are gone.
  const nameMatches = confirm.trim() === projectName.trim();

  async function handleDelete() {
    if (!nameMatches || running) return;
    setRunning(true);
    const tid = toast.loading("Excluindo projeto…");
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Falha (${res.status})`);
      }
      toast.success(`"${projectName}" excluído.`, { id: tid });
      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha na exclusão";
      toast.error(msg, { id: tid });
    } finally {
      setRunning(false);
    }
  }

  // Prevent the click from bubbling to a wrapping <Link> (dashboard card).
  function stopCardNavigation(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
  }

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          aria-label={`Excluir ${projectName}`}
          onClick={(e) => {
            stopCardNavigation(e);
            setOpen(true);
          }}
          onPointerDown={stopCardNavigation}
          className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent bg-background/70 text-muted-foreground opacity-0 backdrop-blur transition-all hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Excluir projeto
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!running) {
            setOpen(v);
            if (!v) setConfirm("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir projeto</DialogTitle>
            <DialogDescription>
              Essa ação é definitiva. Serão apagados o projeto, o cronograma,
              as tarefas, os links com o modelo 3D e o arquivo IFC armazenado.
              Não há como desfazer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Para confirmar, digite o nome do projeto:
            </p>
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
              {projectName}
            </p>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Digite o nome exato"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-destructive focus:ring-1 focus:ring-destructive"
              autoFocus
              disabled={running}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={running}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!nameMatches || running}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Excluir definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
