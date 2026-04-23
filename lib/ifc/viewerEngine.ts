"use client";

import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as WEBIFC from "web-ifc";

export type ElementInfo = {
  globalId: string;
  expressId: number;
  modelId: string;
  type: string;
};

/**
 * A group of elements derived from the IFC itself — either IFC entity
 * types (Wall, Beam, Slab…), spatial structure (Storey, Building, Site),
 * IfcGroup assignments, predefined types, or any Pset property scanned
 * from the file. Used by the linker UI so the user can assign whole
 * buckets of the model to a schedule task with a single click, instead
 * of having to pick elements one by one.
 */
export type GroupingEntry = {
  key: string; // raw key used to look the group back up
  name: string; // display label
  count: number; // unique globalIds in this group
};

/**
 * A whole classification axis — e.g. "by entity", "by storey",
 * "by IFC group". Each system has several groups the user can pick from.
 */
export type ClassificationSystem = {
  /** Unique key of the system (e.g. "entities"). Used when looking up the
   * classifier state and resolving globalIds. */
  key: string;
  /** Human-friendly label shown in the UI. */
  label: string;
  /** Optional description shown as a hint in the dropdown. */
  description?: string;
  groups: GroupingEntry[];
};

/**
 * A property-based grouping axis built from a Pset scan. Each "property"
 * (pset + attribute name) owns the list of distinct values found in the
 * model, each backed by its own set of elements.
 */
export type PropertyGroup = {
  /** Stable key "psetName::propName". */
  key: string;
  psetName: string;
  propName: string;
  /** Total elements that have this property assigned. */
  totalElements: number;
  /** One entry per distinct value — each entry is a bucket the user can
   * select or link. */
  values: GroupingEntry[];
};

export type ClassificationSummary = {
  systems: ClassificationSystem[];
  /** Filled in once `scanPropertyGroups()` has been called for this model. */
  properties: PropertyGroup[];
  propertiesScanned: boolean;
};

/**
 * 4D states used to paint the model as the timeline advances.
 *
 *   - "hidden"         → element not yet started (per baseline); truly invisible.
 *   - "in_progress"    → baseline says it's being built right now (yellow).
 *   - "done_on_time"   → baseline end reached; forecast met or beat it (green).
 *   - "done_delayed"   → baseline end reached but forecast finishes later (red).
 *   - "default"        → element has no task association; rendered as-is.
 */
export type ElementState =
  | "default"
  | "in_progress"
  | "done_on_time"
  | "done_delayed"
  | "hidden";

type HighlightState = "in_progress" | "done_on_time" | "done_delayed";

/**
 * 4D colors. The OBCF Highlighter's `add(name, color)` takes a THREE.Color —
 * it applies that color to the fragments enrolled in the style, so the
 * geometry is tinted without being replaced.
 */
const STATE_COLORS: Record<HighlightState, THREE.Color> = {
  in_progress: new THREE.Color("#facc15"), // amber-400
  done_on_time: new THREE.Color("#22c55e"), // green-500
  done_delayed: new THREE.Color("#ef4444"), // red-500
};

const HIGHLIGHT_STATES: HighlightState[] = [
  "in_progress",
  "done_on_time",
  "done_delayed",
];

export class ViewerEngine {
  components = new OBC.Components();
  world!: OBC.SimpleWorld<
    OBC.SimpleScene,
    OBC.SimpleCamera,
    OBC.SimpleRenderer
  >;
  ifcLoader!: OBC.IfcLoader;
  fragments!: OBC.FragmentsManager;
  classifier!: OBC.Classifier;
  hider!: OBC.Hider;
  highlighter!: OBCF.Highlighter;
  indexer!: OBC.IfcRelationsIndexer;

  private container: HTMLDivElement;
  private resizeObserver: ResizeObserver | null = null;

  // Loaded model (we currently support a single IFC per project).
  private model: import("@thatopen/fragments").FragmentsGroup | null = null;

  // globalId -> expressId
  private globalIdToExpress = new Map<string, number>();
  // expressId -> globalId (for reverse lookups on click)
  private expressToGlobalId = new Map<number, string>();
  // expressId -> fragmentIds[] (for building highlighter FragmentIdMap)
  private expressToFragments = new Map<number, string[]>();

  onSelect: ((info: ElementInfo | null) => void) | null = null;
  onSelectionChange: ((globalIds: string[]) => void) | null = null;
  // Legacy single-slot listener (ClassificationBrowser still wires into it).
  // New consumers should use `addClassificationsListener()` so multiple
  // components (e.g. the linker browser AND the quantity summary boxes)
  // can react to the same events without stomping on each other.
  onClassificationsReady: ((summary: ClassificationSummary) => void) | null =
    null;
  private classificationsListeners = new Set<
    (summary: ClassificationSummary) => void
  >();

  addClassificationsListener(
    cb: (summary: ClassificationSummary) => void
  ): () => void {
    this.classificationsListeners.add(cb);
    return () => {
      this.classificationsListeners.delete(cb);
    };
  }

  private emitClassifications() {
    const summary = this.classificationSummary;
    this.onClassificationsReady?.(summary);
    for (const cb of this.classificationsListeners) {
      try {
        cb(summary);
      } catch (err) {
        console.warn("[viewer] classifications listener threw:", err);
      }
    }
  }

  // Cached classification summary for the currently loaded model. Populated
  // after loadIfc() finishes, consumed by the linker UI.
  private classificationSummary: ClassificationSummary = {
    systems: [],
    properties: [],
    propertiesScanned: false,
  };

  // Property index built on-demand by scanPropertyGroups(). Key is
  // "psetName::propName", inner key is the stringified distinct value.
  private propertyIndex = new Map<string, Map<string, Set<string>>>();

  // The list of (key, label) we expose as "systems" in the UI — only the
  // ones whose groups ended up being non-empty.
  private readonly SYSTEM_LABELS: Array<{
    key: string;
    label: string;
    description?: string;
  }> = [
    { key: "entities", label: "Tipo IFC", description: "Parede, laje, viga…" },
    {
      key: "spatialStructures",
      label: "Pavimento",
      description: "Site → Building → Storey",
    },
    {
      key: "predefinedTypes",
      label: "Subtipo (PredefinedType)",
      description: "Variações do tipo IFC",
    },
    {
      key: "ifcGroups",
      label: "Grupos IFC",
      description: "IfcGroup/IfcSystem/IfcZone",
    },
  ];

  private suppressSelectionChange = false;

  constructor(container: HTMLDivElement) {
    this.container = container;
  }

  async init() {
    const worlds = this.components.get(OBC.Worlds);
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.SimpleCamera,
      OBC.SimpleRenderer
    >();

    world.scene = new OBC.SimpleScene(this.components);
    world.renderer = new OBC.SimpleRenderer(this.components, this.container);
    world.camera = new OBC.SimpleCamera(this.components);

    this.components.init();

    world.scene.setup();
    world.scene.three.background = new THREE.Color("#0b1220");

    const cam3 = world.camera.three as THREE.PerspectiveCamera;
    if (cam3 && "near" in cam3) {
      cam3.near = 0.1;
      cam3.far = 1_000_000;
      cam3.updateProjectionMatrix();
    }

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    world.scene.three.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7);
    world.scene.three.add(dir);

    world.camera.controls.setLookAt(15, 20, 25, 0, 0, 0);

    this.world = world;

    this.fragments = this.components.get(OBC.FragmentsManager);
    this.ifcLoader = this.components.get(OBC.IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: {
        path: "/web-ifc/",
        absolute: true,
      },
    });

    this.classifier = this.components.get(OBC.Classifier);
    this.hider = this.components.get(OBC.Hider);
    this.indexer = this.components.get(OBC.IfcRelationsIndexer);

    this.highlighter = this.components.get(OBCF.Highlighter);
    this.highlighter.setup({ world });
    // Shift+click to ADD to the current selection in the 3D viewer.
    // (Without any modifier a click replaces the selection.)
    this.highlighter.multiple = "shiftKey";

    // Register 4D styles up-front. IMPORTANT: if we call clear() on an
    // unregistered style the Highlighter leaves `selection[name] = {}` in a
    // half-initialized state, and the subsequent add() throws "already
    // exists" — resulting in colors being silently dropped. Registering here
    // guarantees the 3 styles always exist before any clear/highlight call.
    for (const style of HIGHLIGHT_STATES) {
      try {
        this.highlighter.add(style, STATE_COLORS[style]);
      } catch {
        // Already registered (e.g. after HMR) — fine.
      }
      this.registeredStyles.add(style);
    }

    this.highlighter.events.select.onHighlight.add(
      (selection: Record<string, Set<number>>) => {
        if (this.onSelect) {
          this.onSelect(this.firstFromSelection(selection));
        }
        this.emitSelectionChange();
      }
    );

    this.highlighter.events.select.onClear.add(() => {
      if (this.onSelect) this.onSelect(null);
      this.emitSelectionChange();
    });

    this.attachResize();
  }

  private attachResize() {
    const update = () => {
      this.world.renderer?.resize();
      this.world.camera.updateAspect();
    };
    this.resizeObserver = new ResizeObserver(update);
    this.resizeObserver.observe(this.container);
  }

  async loadIfc(buffer: ArrayBuffer): Promise<{
    uuid: string;
    meshCount: number;
    globalIdCount: number;
    bbox: { min: THREE.Vector3; max: THREE.Vector3 } | null;
  }> {
    const data = new Uint8Array(buffer);
    console.log(`[viewer] parsing IFC (${data.byteLength} bytes)…`);
    const t0 = performance.now();
    const model = await this.ifcLoader.load(data);
    const parseMs = Math.round(performance.now() - t0);
    console.log(`[viewer] IFC parsed in ${parseMs}ms, uuid=${model.uuid}`);
    this.model = model;
    this.world.scene.three.add(model);

    // Force matrix world so Box3.setFromObject() produces correct bounds.
    model.updateMatrixWorld(true);

    let meshCount = 0;
    model.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshCount++;
    });

    let box = new THREE.Box3().setFromObject(model);

    // IFC files from BIM projects (especially infrastructure in Brazil) are
    // often georeferenced (e.g. UTM SIRGAS coords ~7,500,000). That is far
    // beyond three.js float32 precision and pushes the model out of sight.
    // Re-center the model at the origin in that case.
    if (isFinite(box.min.x)) {
      const center = box.getCenter(new THREE.Vector3());
      if (center.length() > 10000) {
        console.log(
          `[viewer] model far from origin (|center|=${center.length().toFixed(0)}), re-centering at origin`
        );
        model.position.sub(center);
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
      }
    }

    const bbox = isFinite(box.min.x)
      ? { min: box.min.clone(), max: box.max.clone() }
      : null;

    this.indexGlobalIds(model);
    console.log(
      `[viewer] meshes=${meshCount} globalIds=${this.globalIdToExpress.size} bbox=`,
      bbox
    );

    // Compute the classifications (IFC types + spatial structure) so the
    // linker UI can offer "link whole group at once". Runs in the background
    // and does not block the camera fit / preview for large models.
    this.buildClassifications(model).catch((err) => {
      console.warn("[viewer] classification failed:", err);
    });

    if (bbox) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxSide = Math.max(size.x, size.y, size.z);
      const dist = (isFinite(maxSide) && maxSide > 0 ? maxSide : 20) * 1.8;
      this.world.camera.controls.setLookAt(
        center.x + dist,
        center.y + dist * 0.7,
        center.z + dist,
        center.x,
        center.y,
        center.z,
        false
      );
    }

    return {
      uuid: model.uuid,
      meshCount,
      globalIdCount: this.globalIdToExpress.size,
      bbox,
    };
  }

  /**
   * Build reverse indexes from the FragmentsGroup shipped by @thatopen.
   * - globalToExpressIDs: Map<globalId, expressId> (provided by the group)
   * - keyFragments: Map<key, fragmentId>
   * - data: Map<expressId, [fragmentKeys[], floorAndCatIds[]]>
   * Fast (no async getProperties iteration), works with the Highlighter's
   * FragmentIdMap selection format.
   */
  private indexGlobalIds(
    model: import("@thatopen/fragments").FragmentsGroup
  ) {
    this.globalIdToExpress.clear();
    this.expressToGlobalId.clear();
    this.expressToFragments.clear();

    const globalToExpress = model.globalToExpressIDs;
    const keyFragments = model.keyFragments;
    const data = model.data;

    if (!globalToExpress || !keyFragments || !data) return;

    for (const [gid, expressId] of globalToExpress.entries()) {
      this.globalIdToExpress.set(gid, expressId);
      this.expressToGlobalId.set(expressId, gid);
    }

    for (const [expressId, [fragKeys]] of data.entries()) {
      if (!fragKeys || fragKeys.length === 0) continue;
      const fragIds: string[] = [];
      for (const k of fragKeys) {
        const fragId = keyFragments.get(k);
        if (fragId) fragIds.push(fragId);
      }
      if (fragIds.length > 0) {
        this.expressToFragments.set(expressId, fragIds);
      }
    }
  }

  getGlobalIds(): string[] {
    return Array.from(this.globalIdToExpress.keys());
  }

  /**
   * Emits the complete set of globalIds currently in the highlighter's "select"
   * selection. This is the single source of truth consumed by the UI — we no
   * longer try to accumulate selection state in React, because the Highlighter
   * (with `multiple = "shiftKey"`) already owns that state.
   */
  private emitSelectionChange() {
    if (this.suppressSelectionChange) return;
    if (!this.onSelectionChange) return;
    const sel = (this.highlighter?.selection?.select ?? {}) as Record<
      string,
      Set<number>
    >;
    const seen = new Set<string>();
    const gids: string[] = [];
    for (const ids of Object.values(sel)) {
      for (const expressId of ids) {
        const gid = this.expressToGlobalId.get(expressId);
        if (!gid || seen.has(gid)) continue;
        seen.add(gid);
        gids.push(gid);
      }
    }
    this.onSelectionChange(gids);
  }

  private firstFromSelection(
    selection: Record<string, Set<number>>
  ): ElementInfo | null {
    for (const [fragmentId, ids] of Object.entries(selection)) {
      for (const expressId of ids) {
        const gid = this.expressToGlobalId.get(expressId);
        if (!gid) continue;
        return {
          globalId: gid,
          expressId,
          modelId: fragmentId,
          type: "Element",
        };
      }
    }
    return null;
  }

  /**
   * Build a FragmentIdMap compatible with the Highlighter:
   *   { [fragmentId]: Set<expressId> }
   */
  selectionFromGlobalIds(
    globalIds: Iterable<string>
  ): Record<string, Set<number>> {
    const out: Record<string, Set<number>> = {};
    for (const gid of globalIds) {
      const expressId = this.globalIdToExpress.get(gid);
      if (expressId === undefined) continue;
      const fragIds = this.expressToFragments.get(expressId);
      if (!fragIds) continue;
      for (const fragId of fragIds) {
        if (!out[fragId]) out[fragId] = new Set<number>();
        out[fragId].add(expressId);
      }
    }
    return out;
  }

  /**
   * Apply a 4D state to the model.
   *   - "hidden": element is actually hidden via the Hider (not an overlay).
   *   - "in_progress": yellow overlay via the Highlighter.
   *   - "done_on_time": green overlay — finished on or before baseline_end.
   *   - "done_delayed": red overlay — forecast finishes past baseline_end.
   *   - "default" / unmapped: rendered with their original material.
   *
   * We always start by showing all fragments of the model and clearing the
   * highlighter overlays, then apply the requested buckets. This makes each
   * call self-contained — the previous call doesn't leave residue.
   */
  async apply4DState(states: Map<string, ElementState>) {
    // All 4D styles are pre-registered at init(), so clear() is always safe.
    for (const style of HIGHLIGHT_STATES) {
      try {
        this.highlighter.clear(style);
      } catch (err) {
        console.warn(`[viewer] highlighter.clear(${style}) failed:`, err);
      }
    }

    // Show ALL fragments of the loaded model. Passing no map means "every
    // fragment managed by the FragmentsManager".
    try {
      this.hider.set(true);
    } catch (err) {
      console.warn("[viewer] hider.set(true) failed:", err);
    }

    const buckets: Record<Exclude<ElementState, "default">, Set<string>> = {
      in_progress: new Set(),
      done_on_time: new Set(),
      done_delayed: new Set(),
      hidden: new Set(),
    };

    for (const [gid, state] of states.entries()) {
      if (state === "default") continue;
      buckets[state].add(gid);
    }

    if (buckets.hidden.size > 0) {
      const sel = this.selectionFromGlobalIds(buckets.hidden);
      if (Object.keys(sel).length > 0) {
        try {
          this.hider.set(false, sel);
        } catch (err) {
          console.warn("[viewer] hider.set(false, …) failed:", err);
        }
      }
    }

    for (const style of HIGHLIGHT_STATES) {
      const bucket = buckets[style];
      if (bucket.size === 0) continue;
      const sel = this.selectionFromGlobalIds(bucket);
      if (Object.keys(sel).length === 0) continue;
      try {
        await this.highlighter.highlightByID(style, sel, false, false);
      } catch (err) {
        console.warn(`[viewer] ${style} highlight failed:`, err);
      }
    }
  }

  /**
   * Reset every 4D visual state. Everything becomes visible with its original
   * material. Called when the timeline is reset or the workspace unmounts.
   */
  resetFourD() {
    for (const style of HIGHLIGHT_STATES) {
      try {
        this.highlighter.clear(style);
      } catch {
        // ignore
      }
    }
    try {
      this.hider.set(true);
    } catch {
      // ignore
    }
  }

  private registeredStyles = new Set<HighlightState>();

  /**
   * Programmatically set the "select" selection. We suppress the
   * onSelectionChange callback while doing this so the UI doesn't observe a
   * round-trip of its own write. The caller already knows what it selected.
   */
  async selectByGlobalIds(globalIds: string[]) {
    this.suppressSelectionChange = true;
    try {
      try {
        this.highlighter.clear("select");
      } catch {
        // ignore clear errors
      }
      if (globalIds.length === 0) return;
      const sel = this.selectionFromGlobalIds(globalIds);
      if (Object.keys(sel).length === 0) return;
      try {
        await this.highlighter.highlightByID("select", sel, true, false);
      } catch (err) {
        console.warn("[viewer] selectByGlobalIds failed:", err);
      }
    } finally {
      this.suppressSelectionChange = false;
    }
  }

  /**
   * Run the ThatOpen Classifier on the model. We bucket by:
   *   - IFC entity type (wall, beam, slab…) via `byEntity` — always cheap.
   *   - Spatial structure (site → building → storey) via `bySpatialStructure`,
   *     which requires the relations to have been indexed first.
   *   - PredefinedType (wall subtype, beam subtype…).
   *   - IfcGroup assignments (IfcGroup / IfcSystem / IfcZone bound via
   *     IfcRelAssignsToGroup).
   *
   * Each branch is best-effort: failure in one doesn't prevent the others
   * from being surfaced to the UI. Pset-based grouping is deliberately
   * NOT run here — see scanPropertyGroups() for the on-demand scan.
   */
  private async buildClassifications(
    model: import("@thatopen/fragments").FragmentsGroup
  ) {
    try {
      this.classifier.byEntity(model);
    } catch (err) {
      console.warn("[viewer] classifier.byEntity failed:", err);
    }

    try {
      // Spatial structure and property-based branches both need the IFC
      // relations to have been indexed first.
      await this.indexer.process(model);
    } catch (err) {
      console.warn("[viewer] indexer.process failed:", err);
    }

    try {
      await this.classifier.bySpatialStructure(model, {
        useProperties: true,
        systemName: "spatialStructures",
      });
    } catch (err) {
      console.warn("[viewer] classifier.bySpatialStructure failed:", err);
    }

    try {
      await this.classifier.byPredefinedType(model);
    } catch (err) {
      console.warn("[viewer] classifier.byPredefinedType failed:", err);
    }

    try {
      await this.classifier.byIfcRel(
        model,
        WEBIFC.IFCRELASSIGNSTOGROUP,
        "ifcGroups"
      );
    } catch (err) {
      console.warn("[viewer] classifier.byIfcRel(IFCGROUP) failed:", err);
    }

    this.classificationSummary = this.computeSummary();
    this.emitClassifications();
  }

  private systemEntries(systemKey: string): GroupingEntry[] {
    const bucket = this.classifier.list[systemKey];
    if (!bucket) return [];
    const entries: GroupingEntry[] = [];
    for (const [key, group] of Object.entries(bucket)) {
      const unique = new Set<string>();
      for (const expressIds of Object.values(group.map)) {
        for (const expressId of expressIds) {
          const gid = this.expressToGlobalId.get(expressId);
          if (gid) unique.add(gid);
        }
      }
      if (unique.size === 0) continue;
      entries.push({
        key,
        name: group.name || key,
        count: unique.size,
      });
    }
    // Biggest buckets first — those are usually the most useful for linking.
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }

  private computeSummary(): ClassificationSummary {
    const systems: ClassificationSystem[] = [];
    for (const def of this.SYSTEM_LABELS) {
      const groups = this.systemEntries(def.key);
      if (groups.length === 0) continue;
      systems.push({
        key: def.key,
        label: def.label,
        description: def.description,
        groups,
      });
    }
    return {
      systems,
      properties: this.classificationSummary.properties,
      propertiesScanned: this.classificationSummary.propertiesScanned,
    };
  }

  getClassifications(): ClassificationSummary {
    return this.classificationSummary;
  }

  /**
   * Resolve a classifier group back to the list of IFC globalIds it contains.
   * Used by the linker when the user picks a whole group (e.g. "all walls")
   * and wants to either select or link them in bulk.
   */
  getGlobalIdsForGroup(system: string, key: string): string[] {
    const bucket = this.classifier.list[system];
    if (!bucket) return [];
    const group = bucket[key];
    if (!group) return [];
    const gids = new Set<string>();
    for (const expressIds of Object.values(group.map)) {
      for (const expressId of expressIds) {
        const gid = this.expressToGlobalId.get(expressId);
        if (gid) gids.add(gid);
      }
    }
    return Array.from(gids);
  }

  /**
   * Scan every Property Set (and Element Quantity) in the currently loaded
   * IFC and build an in-memory index:
   *
   *   "psetName::propName" → { value → Set<globalId> }
   *
   * This is the bridge that lets the user ask "give me everything whose
   * pset 'Dados Estruturais.Apoio' equals 'P12'" — useful for grouping by
   * supports, spans, work phases, marks, element marks, project phase,
   * etc., which vary from file to file.
   *
   * Runs synchronously over the local IFC properties; for typical models
   * (<100k entities) completes in a few hundred ms. Throws only on truly
   * malformed inputs; otherwise best-effort and safe to call multiple
   * times.
   */
  async scanPropertyGroups(): Promise<ClassificationSummary> {
    const model = this.model;
    if (!model) return this.classificationSummary;

    const props = model.getLocalProperties();
    if (!props) {
      // Model was loaded without local properties (streamed mode). We can't
      // scan in that case — mark as scanned to avoid spinning forever.
      this.classificationSummary = {
        ...this.classificationSummary,
        properties: [],
        propertiesScanned: true,
      };
      this.emitClassifications();
      return this.classificationSummary;
    }

    // Pass 1 — IfcRelDefinesByProperties: pset expressID → element expressIDs
    const psetToElements = new Map<number, number[]>();
    for (const idStr of Object.keys(props)) {
      const prop = props[Number(idStr)] as Record<string, unknown> | undefined;
      if (!prop || prop.type !== WEBIFC.IFCRELDEFINESBYPROPERTIES) continue;
      const rel = prop as Record<string, unknown>;
      const relating = rel.RelatingPropertyDefinition as
        | { value?: number }
        | undefined;
      const related = rel.RelatedObjects as
        | Array<{ value?: number }>
        | undefined;
      if (!relating?.value || !related?.length) continue;
      const eids = related
        .map((r) => r?.value)
        .filter((v): v is number => typeof v === "number");
      if (eids.length === 0) continue;
      const existing = psetToElements.get(relating.value);
      if (existing) existing.push(...eids);
      else psetToElements.set(relating.value, eids);
    }

    // Pass 2 — iterate property sets and element quantities
    const index = new Map<string, Map<string, Set<string>>>();
    const totals = new Map<string, Set<string>>();

    const readValue = (
      item: Record<string, unknown>
    ): string | null => {
      const keys = [
        "NominalValue",
        "LengthValue",
        "AreaValue",
        "VolumeValue",
        "CountValue",
        "WeightValue",
        "TimeValue",
      ];
      for (const k of keys) {
        const candidate = item[k] as { value?: unknown } | undefined;
        if (candidate && candidate.value !== undefined) {
          const v = candidate.value;
          if (v === null || v === "") return null;
          if (typeof v === "number") {
            // Quantize decimals so "12.3400001" and "12.34" bucket together.
            return Number.isInteger(v) ? String(v) : v.toFixed(3);
          }
          return String(v);
        }
      }
      return null;
    };

    for (const idStr of Object.keys(props)) {
      const prop = props[Number(idStr)] as Record<string, unknown> | undefined;
      if (!prop) continue;
      if (
        prop.type !== WEBIFC.IFCPROPERTYSET &&
        prop.type !== WEBIFC.IFCELEMENTQUANTITY
      )
        continue;

      const psetNameField = prop.Name as { value?: unknown } | undefined;
      const psetName =
        psetNameField && typeof psetNameField.value === "string"
          ? psetNameField.value
          : "Pset";

      const elementEids = psetToElements.get(Number(idStr)) ?? [];
      if (elementEids.length === 0) continue;

      const items =
        (prop.HasProperties as Array<{ value?: number }> | undefined) ??
        (prop.Quantities as Array<{ value?: number }> | undefined) ??
        [];

      for (const ref of items) {
        const itemId = ref?.value;
        if (!itemId) continue;
        const item = props[itemId] as Record<string, unknown> | undefined;
        if (!item) continue;

        const nameField = item.Name as { value?: unknown } | undefined;
        if (!nameField || typeof nameField.value !== "string") continue;
        const propName = nameField.value;

        const rawValue = readValue(item);
        if (rawValue === null) continue;

        const mapKey = `${psetName}::${propName}`;

        let valueMap = index.get(mapKey);
        if (!valueMap) {
          valueMap = new Map();
          index.set(mapKey, valueMap);
        }
        let set = valueMap.get(rawValue);
        if (!set) {
          set = new Set();
          valueMap.set(rawValue, set);
        }
        let totalSet = totals.get(mapKey);
        if (!totalSet) {
          totalSet = new Set();
          totals.set(mapKey, totalSet);
        }

        for (const eid of elementEids) {
          const gid = this.expressToGlobalId.get(eid);
          if (!gid) continue;
          set.add(gid);
          totalSet.add(gid);
        }
      }
    }

    this.propertyIndex = index;

    // Build a display-friendly list of PropertyGroup objects.
    const properties: PropertyGroup[] = [];
    for (const [mapKey, valueMap] of index.entries()) {
      const [psetName, propName] = mapKey.split("::");
      const values: GroupingEntry[] = [];
      for (const [value, gids] of valueMap.entries()) {
        if (gids.size === 0) continue;
        values.push({ key: value, name: value, count: gids.size });
      }
      if (values.length === 0) continue;
      values.sort((a, b) => b.count - a.count);
      properties.push({
        key: mapKey,
        psetName,
        propName,
        totalElements: totals.get(mapKey)?.size ?? 0,
        values,
      });
    }
    // Sort by pset, then prop name — alphabetical, feels orderly in a menu.
    properties.sort(
      (a, b) =>
        a.psetName.localeCompare(b.psetName) ||
        a.propName.localeCompare(b.propName)
    );

    this.classificationSummary = {
      ...this.classificationSummary,
      properties,
      propertiesScanned: true,
    };
    this.emitClassifications();
    return this.classificationSummary;
  }

  /**
   * Resolve a property bucket (pset + attribute + specific value) back to
   * globalIds. `propertyKey` is the "psetName::propName" key used in the UI.
   */
  getGlobalIdsForProperty(propertyKey: string, value: string): string[] {
    const bucket = this.propertyIndex.get(propertyKey);
    if (!bucket) return [];
    const set = bucket.get(value);
    if (!set) return [];
    return Array.from(set);
  }

  /**
   * Flatten a property bucket into a per-globalId numeric map. Used by the
   * quantity summary (volume / area / count accumulated over the timeline).
   * Values that can't be parsed as a number are dropped — a property like
   * "ExtendedProperties::Material" doesn't make sense to sum, so it simply
   * returns an empty map and the UI can disable the box.
   *
   * When the same globalId appears under more than one value of the same
   * property (rare, but possible with overlapping psets), we keep the
   * highest number so "Volume" never ends up double-counted.
   */
  getQuantityForProperty(propertyKey: string): Map<string, number> {
    const bucket = this.propertyIndex.get(propertyKey);
    if (!bucket) return new Map();
    const out = new Map<string, number>();
    for (const [rawValue, gids] of bucket.entries()) {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) continue;
      for (const gid of gids) {
        const prev = out.get(gid);
        if (prev === undefined || n > prev) out.set(gid, n);
      }
    }
    return out;
  }

  /**
   * Return only the PropertyGroups that look like numeric quantities, so the
   * summary dropdown doesn't get polluted with strings like material names
   * or Revit categories. A group is considered numeric when at least one of
   * its distinct values parses to a finite number.
   */
  getNumericPropertyGroups(): PropertyGroup[] {
    return this.classificationSummary.properties.filter((g) =>
      g.values.some((v) => Number.isFinite(Number(v.key)))
    );
  }

  fitToScene() {
    const box = new THREE.Box3().setFromObject(this.world.scene.three);
    if (!isFinite(box.min.x)) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.5;
    this.world.camera.controls.setLookAt(
      center.x + dist,
      center.y + dist * 0.7,
      center.z + dist,
      center.x,
      center.y,
      center.z,
      true
    );
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.components.dispose();
  }
}
