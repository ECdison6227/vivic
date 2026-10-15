import { z } from "zod";
import { CardRecordSchema, ViewportSchema, type CardRecord } from "@/contracts";
import type { VivicState } from "@/state/canvasStore";

/**
 * Persisted canvas shape (non-secret data only). A trimmed subset of the live
 * runtime state: subtitle/highlight/pending-deletes/stage are transient and
 * never stored; full snapshots use VivicStateSchema over the wire instead.
 */
export const CanvasRecordSchema = z.strictObject({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  version: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  cardsById: z.record(z.string(), CardRecordSchema),
  cardOrder: z.array(z.string().min(1).max(128)),
  viewport: ViewportSchema,
  focusHistory: z.array(z.string().min(1).max(128)).max(20),
  processedRequestIds: z.array(z.string().min(1).max(128)).max(500).optional(),
});

export type CanvasRecord = z.infer<typeof CanvasRecordSchema>;

const baseVivicState = (): Omit<VivicState, "cards" | "viewport" | "focusHistory" | "processedRequestIds"> => ({
  stage: "STANDBY",
  awakenedAt: null,
  undoStack: [],
  pendingDeletes: {},
  focus: null,
  viewportSize: null,
  highlight: null,
  subtitle: null,
  activity: null,
  targetChoice: null,
  ambient: { preset: "grainient", theme: "auto" },
  lastFitRequestId: null,
});

export const toCanvasRecord = (
  id: string,
  title: string,
  version: number,
  state: VivicState,
): CanvasRecord => {
  const live = state.cards
    .filter((c) => !c.exitingRequestId)
    .map((c) => c.record);
  return {
    id,
    title,
    version,
    updatedAt: new Date().toISOString(),
    cardsById: Object.fromEntries(live.map((c: CardRecord) => [c.id, c])),
    cardOrder: live.map((c) => c.id),
    viewport: state.viewport,
    focusHistory: state.focusHistory,
    processedRequestIds: state.processedRequestIds,
  };
};

export const fromCanvasRecord = (record: CanvasRecord): VivicState => {
  const cards = record.cardOrder
    .map((id) => record.cardsById[id])
    .filter((c): c is CardRecord => Boolean(c))
    .map((record) => ({ record }));
  return {
    ...baseVivicState(),
    // A canvas that already has cards restores straight into the workspace.
    stage: cards.length > 0 ? "WORKSPACE" : "STANDBY",
    cards,
    viewport: record.viewport,
    focusHistory: record.focusHistory,
    processedRequestIds: record.processedRequestIds ?? [],
  };
};

export const emptyVivicState = (): VivicState => ({
  ...baseVivicState(),
  cards: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  focusHistory: [],
  processedRequestIds: [],
});
