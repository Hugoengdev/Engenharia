"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Unlink, MousePointerClick, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProjectStore } from "@/lib/store/projectStore";
import { createClient } from "@/lib/supabase/client";
import type { ViewerEngine, ElementInfo } from "@/lib/ifc/viewerEngine";
import { ClassificationBrowser } from "@/components/linker/ClassificationBrowser";

interface Props {
  engine: ViewerEngine | null;
  selectedElement: ElementInfo | null;
}

export function TaskElementLinker({ engine }: Props) {
  const tasks = useProjectStore((s) => s.tasks);
  const selectedTaskId = useProjectStore((s) => s.selectedTaskId);
  const setSelectedTask = useProjectStore((s) => s.setSelectedTask);
  const setLinksForTask = useProjectStore((s) => s.setLinksForTask);
  const selectedGlobalIds = useProjectStore((s) => s.selectedGlobalIds);
  const setSelectedGlobalIds = useProjectStore((s) => s.setSelectedGlobalIds);

  const [pending, setPending] = useState(false);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  // When the user switches tasks, sync the 3D "select" style to show what is
  // already linked. The engine suppresses its own onSelectionChange while
  // doing this, and we mirror the new selection into the store so the counter
  // and the Linkar button are accurate.
  useEffect(() => {
    if (!engine) return;
    const gids = selectedTask?.ifc_global_ids ?? [];
    engine.selectByGlobalIds(gids).catch(() => {
      /* ignore */
    });
    setSelectedGlobalIds(gids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId, engine, selectedTask?.ifc_global_ids.length]);

  async function handleLink() {
    if (!selectedTask || selectedGlobalIds.length === 0) return;
    setPending(true);
    try {
      const supabase = createClient();
      const alreadyLinked = new Set(selectedTask.ifc_global_ids);
      const toInsert = selectedGlobalIds.filter((g) => !alreadyLinked.has(g));
      const merged = Array.from(
        new Set([...selectedTask.ifc_global_ids, ...selectedGlobalIds])
      );
      if (toInsert.length === 0) {
        toast.info("Nenhum elemento novo para linkar");
        return;
      }
      const rows = toInsert.map((gid) => ({
        task_id: selectedTask.id,
        ifc_global_id: gid,
      }));
      const { error } = await supabase
        .from("task_elements")
        .upsert(rows, { onConflict: "task_id,ifc_global_id" });
      if (error) throw error;
      setLinksForTask(selectedTask.id, merged);
      engine?.selectByGlobalIds(merged).catch(() => {
        /* ignore */
      });
      setSelectedGlobalIds(merged);
      toast.success(`${toInsert.length} elemento(s) linkado(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao linkar";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  async function handleUnlinkAll() {
    if (!selectedTask) return;
    if (!confirm("Remover todos os links desta tarefa?")) return;
    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("task_elements")
        .delete()
        .eq("task_id", selectedTask.id);
      if (error) throw error;
      setLinksForTask(selectedTask.id, []);
      setSelectedGlobalIds([]);
      engine?.selectByGlobalIds([]).catch(() => {
        /* ignore */
      });
      toast.success("Links removidos");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao remover";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  function clearSelection() {
    setSelectedGlobalIds([]);
    engine?.selectByGlobalIds([]).catch(() => {
      /* ignore */
    });
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Link2 className="h-4 w-4 text-primary" />
          Linkagem 4D
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Crie ou importe tarefas para começar a linkar.
          </p>
        )}

        {tasks.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Tarefa selecionada
            </label>
            <select
              value={selectedTaskId ?? ""}
              onChange={(e) => setSelectedTask(e.target.value || null)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">— Escolha uma tarefa —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.ifc_global_ids.length > 0
                    ? ` · ${t.ifc_global_ids.length} elem.`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <MousePointerClick className="h-3.5 w-3.5" />
              Selecionados no 3D
            </span>
            <span className="font-mono text-foreground">
              {selectedGlobalIds.length}
            </span>
          </div>
          {selectedGlobalIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-[11px]"
              onClick={clearSelection}
            >
              Limpar seleção
            </Button>
          )}
        </div>

        {selectedTask && (
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Linkados a esta tarefa
              </span>
              <span className="font-mono text-foreground">
                {selectedTask.ifc_global_ids.length}
              </span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            onClick={handleLink}
            disabled={
              !selectedTask || selectedGlobalIds.length === 0 || pending
            }
          >
            <Link2 className="h-3.5 w-3.5" />
            Linkar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnlinkAll}
            disabled={
              !selectedTask ||
              selectedTask.ifc_global_ids.length === 0 ||
              pending
            }
          >
            <Unlink className="h-3.5 w-3.5" />
            Desfazer todos
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          No viewer 3D: <b>clique</b> para selecionar um elemento,{" "}
          <b>Shift+clique</b> para adicionar ou remover mais elementos da
          seleção. Depois escolha uma tarefa acima e clique em <em>Linkar</em>.
        </p>

        <ClassificationBrowser engine={engine} />
      </CardContent>
    </Card>
  );
}
