import { describe, expect, it } from "vitest";
import {
  fromCanvasRecord,
  toCanvasRecord,
  emptyVivicState,
} from "../canvasRecord";
import {
  fileToCanvasRecord,
  parseCanvasFile,
  toCanvasFile,
} from "../canvasFile";
import { createMemoryDB } from "../db";
import { createCanvasStore } from "@/state/canvasStore";
import type { CardRecord } from "@/contracts";

const fixedNow = "2026-10-14T10:00:00.000Z";

const todoCard = (id: string): CardRecord => ({
  id,
  type: "TodoCard",
  variant: "minimal",
  displayProps: {
    items: [
      { id: `${id}-1`, text: "写报告", done: true },
      { id: `${id}-2`, text: "回邮件", done: false },
    ],
  },
  sourceData: {},
  sources: [],
  layout: { x: 0, y: 0, width: 288, height: 160, pinned: false },
  metadata: { createdAt: fixedNow, updatedAt: fixedNow, aliases: ["工作"] },
});

const buildStoreWithCards = () => {
  const store = createCanvasStore();
  store.dispatch({
    schemaVersion: "0.6",
    requestId: "r1",
    canvasId: "c1",
    actions: [
      { type: "stage.awaken" },
      { type: "card.create", card: todoCard("todo-1") },
      { type: "card.create", card: todoCard("todo-2") },
    ],
  });
  store.internal({ type: "stage.awakening.complete" });
  store.internal({ type: "canvas.viewport", viewport: { x: 12, y: 34, zoom: 1.2 } });
  store.dispatch({
    schemaVersion: "0.6",
    requestId: "r2",
    canvasId: "c1",
    actions: [{ type: "card.focus", targetId: "todo-1" }],
  });
  return store;
};

describe("canvas record round-trip", () => {
  it("store -> record -> store keeps cards, order, viewport, focus history", async () => {
    const store = buildStoreWithCards();
    const record = toCanvasRecord("c1", "演示画布", 7, store.getState());
    const db = createMemoryDB();
    await db.putCanvas(record);
    const loaded = await db.getCanvas("c1");
    expect(loaded).toBeDefined();

    const revived = createCanvasStore();
    revived.loadState(fromCanvasRecord(loaded!));
    const state = revived.getState();
    expect(state.stage).toBe("WORKSPACE"); // cards exist => restored awake
    expect(state.cards.map((c) => c.record.id)).toEqual(["todo-1", "todo-2"]);
    expect(state.viewport).toEqual({ x: 12, y: 34, zoom: 1.2 });
    expect(state.focusHistory).toContain("todo-1");
    expect(state.undoStack).toHaveLength(0);
  });

  it("empty canvas restores to STANDBY", () => {
    const revived = fromCanvasRecord({
      id: "c2",
      title: "空",
      version: 0,
      updatedAt: fixedNow,
      cardsById: {},
      cardOrder: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      focusHistory: [],
    });
    expect(revived.stage).toBe("STANDBY");
  });
});

describe("JSON export/import", () => {
  it("export file validates and re-imports with the same cards", () => {
    const store = buildStoreWithCards();
    const record = toCanvasRecord("c1", "演示画布", 3, store.getState());
    const file = toCanvasFile(record);
    const text = JSON.stringify(file);
    const parsed = parseCanvasFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const reimported = fileToCanvasRecord(parsed.file, "c9");
      expect(reimported.title).toBe("演示画布");
      expect(reimported.cardOrder).toEqual(["todo-1", "todo-2"]);
      expect(reimported.cardsById["todo-1"]?.metadata.aliases).toEqual(["工作"]);
      expect(reimported.version).toBe(0);
    }
  });

  it("rejects non-JSON and schema violations", () => {
    expect(parseCanvasFile("not json").ok).toBe(false);
    expect(parseCanvasFile("{}").ok).toBe(false);
    // Unknown card field must be rejected (B07).
    const bad = {
      schemaVersion: "0.6",
      app: "vivic",
      exportedAt: fixedNow,
      canvas: {
        title: "x",
        viewport: { x: 0, y: 0, zoom: 1 },
        focusHistory: [],
        cards: [
          {
            ...todoCard("t"),
            displayProps: { items: [{ id: "a", text: "x", done: false }], advice: "偷塞" },
          },
        ],
      },
    };
    expect(parseCanvasFile(JSON.stringify(bad)).ok).toBe(false);
    // Countdown with a description is contractually illegal.
    const badCountdown = {
      ...bad,
      canvas: {
        ...bad.canvas,
        cards: [
          {
            id: "cd",
            type: "CountdownCard",
            variant: "minimal",
            displayProps: { description: "距离结束" },
            sourceData: { targetAt: fixedNow },
            sources: [],
            layout: { x: 0, y: 0, width: 264, height: 96, pinned: false },
            metadata: { createdAt: fixedNow, updatedAt: fixedNow },
          },
        ],
      },
    };
    expect(parseCanvasFile(JSON.stringify(badCountdown)).ok).toBe(false);
  });
});

describe("memory db parity", () => {
  it("put/get/delete/list round-trip", async () => {
    const db = createMemoryDB();
    const record = toCanvasRecord("c1", "T", 0, emptyVivicState());
    await db.putCanvas(record);
    expect((await db.getCanvas("c1"))?.title).toBe("T");
    expect(await db.getAllCanvases()).toHaveLength(1);
    await db.setMeta("lastCanvasId", "c1");
    expect(await db.getMeta("lastCanvasId")).toBe("c1");
    await db.deleteCanvas("c1");
    expect(await db.getCanvas("c1")).toBeUndefined();
  });
});
