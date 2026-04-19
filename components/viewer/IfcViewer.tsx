"use client";

import { useEffect, useRef, useState } from "react";
import { Focus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ViewerEngine, ElementInfo } from "@/lib/ifc/viewerEngine";

export interface IfcViewerHandle {
  engine: ViewerEngine | null;
}

interface Props {
  ifcUrl?: string | null;
  onSelect?: (info: ElementInfo | null) => void;
  onSelectionChange?: (globalIds: string[]) => void;
  onReady?: (engine: ViewerEngine) => void;
  className?: string;
}

interface DebugInfo {
  downloadedBytes: number;
  meshCount: number;
  globalIdCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
}

export function IfcViewer({
  ifcUrl,
  onSelect,
  onSelectionChange,
  onReady,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [engine, setEngineState] = useState<ViewerEngine | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [hasModel, setHasModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DebugInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    let localEngine: ViewerEngine | null = null;

    async function boot() {
      if (!containerRef.current) return;
      const { ViewerEngine } = await import("@/lib/ifc/viewerEngine");
      localEngine = new ViewerEngine(containerRef.current);
      await localEngine.init();
      if (cancelled) {
        localEngine.dispose();
        return;
      }
      localEngine.onSelect = (info) => onSelect?.(info);
      localEngine.onSelectionChange = (gids) => onSelectionChange?.(gids);
      setEngineState(localEngine);
      onReady?.(localEngine);
    }

    boot().catch((err) => {
      console.error(err);
      setError(err instanceof Error ? err.message : "Erro ao iniciar o viewer");
    });

    return () => {
      cancelled = true;
      localEngine?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!engine || !ifcUrl) return;
    let cancelled = false;
    async function load() {
      if (!engine || !ifcUrl) return;
      setLoading(true);
      setError(null);
      setDebug(null);
      setProgress("Baixando IFC…");
      try {
        const res = await fetch(ifcUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar IFC`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;
        setProgress(
          `Processando IFC (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)…`
        );
        const info = await engine.loadIfc(buffer);
        if (cancelled) return;
        const dbg: DebugInfo = {
          downloadedBytes: buffer.byteLength,
          meshCount: info.meshCount,
          globalIdCount: info.globalIdCount,
          bbox: info.bbox
            ? {
                min: [info.bbox.min.x, info.bbox.min.y, info.bbox.min.z],
                max: [info.bbox.max.x, info.bbox.max.y, info.bbox.max.z],
              }
            : null,
        };
        setDebug(dbg);
        setHasModel(true);
        if (info.meshCount === 0) {
          toast.error(
            "IFC processado, mas nenhuma geometria foi gerada. O arquivo pode estar corrompido ou usar categorias não suportadas."
          );
        } else {
          toast.success(`Modelo carregado: ${info.meshCount} meshes`);
        }
      } catch (err) {
        console.error("[viewer] erro ao carregar IFC:", err);
        const msg = err instanceof Error ? err.message : "Erro ao carregar IFC";
        setError(msg);
        toast.error(`Erro ao carregar IFC: ${msg}`);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProgress("");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [ifcUrl, engine]);

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[#0b1220] ${className ?? ""}`}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {(loading || error) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="pointer-events-auto rounded-lg border border-border/60 bg-card/90 px-4 py-3 text-sm backdrop-blur">
            {loading && (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {progress || "Carregando IFC…"}
              </span>
            )}
            {!loading && error && (
              <span className="text-destructive">{error}</span>
            )}
          </div>
        </div>
      )}

      {debug && (
        <div className="absolute bottom-3 left-3 rounded-md border border-border/60 bg-card/90 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground backdrop-blur">
          <div>
            IFC: {(debug.downloadedBytes / 1024 / 1024).toFixed(1)} MB |
            meshes: {debug.meshCount} | globalIds: {debug.globalIdCount}
          </div>
          {debug.bbox ? (
            <div>
              bbox min: [{debug.bbox.min.map((v) => v.toFixed(1)).join(", ")}]
              <br />
              bbox max: [{debug.bbox.max.map((v) => v.toFixed(1)).join(", ")}]
            </div>
          ) : (
            <div className="text-destructive">
              Sem bounding box — modelo vazio ou sem geometria.
            </div>
          )}
        </div>
      )}

      {!ifcUrl && !loading && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Nenhum IFC carregado neste projeto.
        </div>
      )}

      {hasModel && (
        <div className="absolute right-3 top-3 flex gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => engine?.fitToScene()}
            title="Centralizar modelo"
            className="h-8 w-8 bg-card/90 backdrop-blur"
          >
            <Focus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
