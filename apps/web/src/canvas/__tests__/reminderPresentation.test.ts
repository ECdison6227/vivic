import { expect, it } from "vitest";
import { presentCards } from "../reminderPresentation";
import { createCanvasStore, hasUnpinnedOverlap } from "@/state/canvasStore";
import { testCards } from "@/cards/__tests__/fixtures";
import type { CountdownCard } from "@/contracts";
const timer = (id: string, text?: string): CountdownCard => ({ ...testCards.CountdownCard, id, layout: { ...testCards.CountdownCard.layout, width: 264, height: 96 }, sourceData: { targetAt: "2099-10-15T08:00:00.000Z", ...(text ? { reminderText: text } : {}) } });
it("presents named reminders as one list while keeping plain timers and pinned cards independent", () => {
  const a = timer("a", "喝水"), b = timer("b", "休息"), plain = timer("plain");
  const view = presentCards([a, b, plain].map(record => ({ record })));
  expect(view).toHaveLength(2); expect(view[0]!.memberIds).toEqual(["a", "b"]);
  expect(view[0]!.reminders?.map(card => card.sourceData.reminderText)).toEqual(["喝水", "休息"]);
  const pinned = { ...b, layout: { ...b.layout, x: 800, pinned: true } };
  expect(presentCards([a, pinned, plain].map(record => ({ record })))).toHaveLength(3);
});
it("expires delivered one-offs from the display without losing condition history or recurring schedules", () => {
  const a = timer("a", "喝水"), done = { ...a, sourceData: { ...a.sourceData, notifiedAt: "2026-10-16T00:00:00.000Z" } };
  expect(presentCards([{ record: done }])).toHaveLength(0);
  expect(presentCards([{ record: { ...done, sourceData: { ...done.sourceData, notifiedAt: null, schedule: { kind: "interval", everySeconds: 60 } } } }])).toHaveLength(1);
  expect(done.sourceData.notifiedAt).toBeTruthy();
});
it("reserves group height around pinned obstacles and moves the group through the existing interaction", () => {
  const store = createCanvasStore();
  const pinned = { ...testCards.TodoCard, layout: { ...testCards.TodoCard.layout, pinned: true } };
  store.dispatch({ schemaVersion: "0.6", canvasId: "TEST", requestId: "seed", actions: [pinned, timer("a", "很长的事项".repeat(20)), timer("b", "休息")].map(card => ({ type: "card.create", card })) });
  expect(hasUnpinnedOverlap(store.getState().cards)).toBe(false);
  const before = store.getState().cards.find(c => c.record.id === "a")!.record.layout;
  expect(store.interact("move", { kind: "card.move", cardId: "a", from: before, x: 900, y: 900 }).ok).toBe(true);
  const cards = store.getState().cards;
  expect(cards.find(c => c.record.id === "b")!.record.layout.x).toBe(900);
  expect(cards.find(c => c.record.id === pinned.id)!.record.layout).toEqual(pinned.layout);
});
