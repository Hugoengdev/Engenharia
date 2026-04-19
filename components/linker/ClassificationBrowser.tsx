"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Search,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectStore } from "@/lib/store/projectStore";
import type {
  ClassificationSummary,
  GroupingEntry,
  PropertyGroup,
  ViewerEngine,
} from "@/lib/ifc/viewerEngine";

interface Props {
  engine: ViewerEngine | null;
}

/**
 * Human-friendly labels for the most common IFC entity types. If a type is
 * not in the map we just strip the `IFC` prefix and title-case the rest so the
 * list stays readable regardless of the file's vocabulary.
 */
const ENTITY_LABELS: Record<string, string> = {
  IFCWALL: "Paredes",
  IFCWALLSTANDARDCASE: "Paredes (padrão)",
  IFCSLAB: "Lajes",
  IFCROOF: "Coberturas",
  IFCBEAM: "Vigas",
  IFCCOLUMN: "Pilares",
  IFCDOOR: "Portas",
  IFCWINDOW: "Janelas",
  IFCSTAIR: "Escadas",
  IFCSTAIRFLIGHT: "Lances de escada",
  IFCRAILING: "Guarda-corpos",
  IFCPLATE: "Chapas",
  IFCMEMBER: "Perfis",
  IFCCURTAINWALL: "Fachadas cortina",
  IFCFOOTING: "Fundações",
  IFCPILE: "Estacas",
  IFCRAMP: "Rampas",
  IFCROOFING: "Telhados",
  IFCCOVERING: "Revestimentos",
  IFCFURNISHINGELEMENT: "Mobiliário",
  IFCBUILDINGELEMENTPROXY: "Elementos genéricos",
  IFCFLOWTERMINAL: "Terminais (MEP)",
  IFCFLOWSEGMENT: "Dutos / tubulações",
  IFCFLOWFITTING: "Conexões (MEP)",
  IFCDISTRIBUTIONELEMENT: "Elementos de distribuição",
  IFCPIPEFITTING: "Conexões de tubulação",
  IFCPIPESEGMENT: "Tubulações",
  IFCDUCTFITTING: "Conexões de duto",
  IFCDUCTSEGMENT: "Dutos",
  IFCREINFORCINGBAR: "Armaduras",
  IFCREINFORCEMENT: "Armaduras",
  IFCCABLECARRIERSEGMENT: "Eletrocalhas",
  IFCCABLESEGMENT: "Cabos",
};

function prettifyEntityName(raw: string): string {
  const upper = raw.toUpperCase();
  if (ENTITY_LABELS[upper]) return ENTITY_LABELS[upper];
  // Fallback: strip the IFC prefix and title-case the rest.
  const stripped = upper.startsWith("IFC") ? upper.slice(3) : upper;
  return stripped
    .toLowerCase()
    .split(/[_\s]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Synthetic value used in the axis dropdown to enter "property mode".
 * Anything starting with `prop::` selects a specific Pset property.
 */
const PROPERTY_ROOT = "__properties__";

export function ClassificationBrowser({ engine }: Props) {
  const selectedGlobalIds = useProjectStore((s) => s.selectedGlobalIds);
  const setSelectedGlobalIds = useProjectStore((s) => s.setSelectedGlobalIds);

  const [open, setOpen] = useState(true);
  const [summary, setSummary] = useState<ClassificationSummary>({
    systems: [],
    properties: [],
    propertiesScanned: false,
  });
  // The axis drives which list of groups is shown. Either a classifier
  // system key (e.g. "entities"), "__properties__" for the property picker
  // (shows an empty list until a specific property is chosen), or
  // "prop::Pset::Attr" for a specific property's distinct values.
  const [axis, setAxis] = useState<string>("");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);

  // Sync with the engine: read current summary, subscribe for updates when
  // classification finishes or a property scan completes.
  useEffect(() => {
    if (!engine) {
      setSummary({
        systems: [],
        properties: [],
        propertiesScanned: false,
      });
      setAxis("");
      return;
    }
    const current = engine.getClassifications();
    setSummary(current);
    engine.onClassificationsReady = (next) => setSummary(next);
    return () => {
      if (engine) engine.onClassificationsReady = null;
    };
  }, [engine]);

  // Default the axis to the first available system once classification
  // lands; leave the user's explicit choice alone afterwards.
  useEffect(() => {
    if (!axis && summary.systems.length > 0) {
      setAxis(summary.systems[0].key);
    }
  }, [summary.systems, axis]);

  // When the user switches axis, clear the search so they don't land on a
  // filter that hides everything.
  useEffect(() => {
    setQuery("");
  }, [axis]);

  const activeSystem = useMemo(() => {
    if (!axis || axis.startsWith("prop::") || axis === PROPERTY_ROOT)
      return null;
    return summary.systems.find((s) => s.key === axis) ?? null;
  }, [axis, summary.systems]);

  const activeProperty: PropertyGroup | null = useMemo(() => {
    if (!axis?.startsWith("prop::")) return null;
    const key = axis.slice("prop::".length);
    return summary.properties.find((p) => p.key === key) ?? null;
  }, [axis, summary.properties]);

  /**
   * The unified list of entries the user sees for the selected axis.
   * For a classifier system we map entries with the entity prettifier;
   * for a property axis we list its distinct values verbatim.
   */
  const rows = useMemo(() => {
    if (activeSystem) {
      return activeSystem.groups.map((g) => {
        const label =
          activeSystem.key === "entities"
            ? prettifyEntityName(g.name)
            : g.name;
        const sub =
          activeSystem.key === "entities" && label !== g.name ? g.name : null;
        return { entry: g, label, sub };
      });
    }
    if (activeProperty) {
      return activeProperty.values.map((g) => ({
        entry: g,
        label: g.name || "(vazio)",
        sub: null,
      }));
    }
    return [];
  }, [activeSystem, activeProperty]);

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.entry.key.toLowerCase().includes(q) ||
        (row.sub ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  function resolveGlobalIds(entry: GroupingEntry): string[] {
    if (!engine) return [];
    if (activeSystem) {
      return engine.getGlobalIdsForGroup(activeSystem.key, entry.key);
    }
    if (activeProperty) {
      return engine.getGlobalIdsForProperty(activeProperty.key, entry.key);
    }
    return [];
  }

  function selectGroup(entry: GroupingEntry, mode: "replace" | "add") {
    if (!engine) return;
    const gids = resolveGlobalIds(entry);
    if (gids.length === 0) return;

    const next =
      mode === "replace"
        ? gids
        : Array.from(new Set([...selectedGlobalIds, ...gids]));

    setSelectedGlobalIds(next);
    engine.selectByGlobalIds(next).catch(() => {
      /* ignore */
    });
  }

  async function handleScanProperties() {
    if (!engine || scanning) return;
    setScanning(true);
    try {
      const next = await engine.scanPropertyGroups();
      setSummary(next);
      if (next.properties.length === 0) {
        toast.info(
          "Nenhuma propriedade encontrada no IFC (modelo sem Psets?)."
        );
      } else {
        toast.success(
          `${next.properties.length} propriedade(s) encontrada(s). Escolha qual usar para agrupar.`
        );
        // Jump straight into the property picker once we have something.
        setAxis(PROPERTY_ROOT);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao escanear propriedades";
      toast.error(msg);
    } finally {
      setScanning(false);
    }
  }

  const hasAnyClassifier = summary.systems.length > 0;
  const hasAnyProperty = summary.properties.length > 0;

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs"
      >
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Boxes className="h-3.5 w-3.5 text-primary" />
          Agrupamentos do modelo
          {hasAnyClassifier && (
            <span className="ml-1 text-muted-foreground">
              ({summary.systems.length} eixos
              {hasAnyProperty ? ` + ${summary.properties.length} props` : ""})
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border/60 p-3">
          {!engine || !hasAnyClassifier ? (
            <p className="text-[11px] text-muted-foreground">
              Carregue um IFC para ver os agrupamentos disponíveis.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Agrupar por
                </label>
                <select
                  value={axis}
                  onChange={(e) => setAxis(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-[11px]"
                >
                  <optgroup label="Classificação IFC">
                    {summary.systems.map((sys) => (
                      <option key={sys.key} value={sys.key}>
                        {sys.label} ({sys.groups.length})
                        {sys.description ? ` — ${sys.description}` : ""}
                      </option>
                    ))}
                  </optgroup>
                  {(summary.propertiesScanned || hasAnyProperty) && (
                    <optgroup label="Propriedades (Pset)">
                      {!hasAnyProperty && (
                        <option value={PROPERTY_ROOT} disabled>
                          Nenhuma propriedade encontrada
                        </option>
                      )}
                      {hasAnyProperty && (
                        <option value={PROPERTY_ROOT}>
                          — Escolha uma propriedade —
                        </option>
                      )}
                      {summary.properties.map((prop) => (
                        <option key={prop.key} value={`prop::${prop.key}`}>
                          {prop.psetName} → {prop.propName} (
                          {prop.values.length})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {!summary.propertiesScanned && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-full text-[11px]"
                    onClick={handleScanProperties}
                    disabled={scanning || !engine}
                  >
                    {scanning ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Escaneando propriedades…
                      </>
                    ) : (
                      <>
                        <Search className="h-3 w-3" />
                        Escanear propriedades (Psets)
                      </>
                    )}
                  </Button>
                )}
              </div>

              {axis === PROPERTY_ROOT && (
                <p className="rounded-md border border-dashed border-border/60 bg-background/40 px-2 py-2 text-[11px] text-muted-foreground">
                  Escolha uma propriedade no seletor acima (por exemplo{" "}
                  <span className="font-mono">Dados Estruturais → Apoio</span>)
                  para ver os valores encontrados no modelo.
                </p>
              )}

              {(activeSystem || activeProperty) && (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={
                        activeProperty
                          ? `Buscar valor de ${activeProperty.propName}`
                          : "Buscar grupo"
                      }
                      className="h-7 pl-7 text-[11px]"
                    />
                  </div>

                  <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {filtered.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">
                        Nenhum grupo encontrado.
                      </p>
                    ) : (
                      filtered.map((row) => (
                        <div
                          key={`${axis}:${row.entry.key}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-transparent bg-background/60 px-2 py-1.5 text-[11px] hover:border-border/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-foreground">
                              {row.label}
                            </div>
                            {row.sub && (
                              <div className="truncate font-mono text-[10px] text-muted-foreground">
                                {row.sub}
                              </div>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {row.entry.count}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Selecionar apenas este grupo no 3D"
                              onClick={() =>
                                selectGroup(row.entry, "replace")
                              }
                            >
                              <Target className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Adicionar este grupo à seleção atual"
                              onClick={() => selectGroup(row.entry, "add")}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              <p className="text-[10px] leading-snug text-muted-foreground">
                Clique em{" "}
                <Target className="inline h-2.5 w-2.5 align-[-1px]" /> para
                selecionar só o grupo no 3D, ou em{" "}
                <Plus className="inline h-2.5 w-2.5 align-[-1px]" /> para
                somá-lo à seleção atual. Depois escolha a tarefa e clique em{" "}
                <em>Linkar</em>.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
