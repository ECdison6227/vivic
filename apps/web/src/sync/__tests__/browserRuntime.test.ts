import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDB } from "@/persistence/db";
import { canvasStore } from "@/state/canvasStore";
import type { SyncMessage } from "../protocol";
import type { DisplayRuntime } from "../browserRuntime";

vi.mock("@/persistence/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@/persistence/db")>();
  return { ...actual, openVivicDB: vi.fn(async () => actual.createMemoryDB()) };
});
vi.mock("../channel", async importOriginal => {
  const actual = await importOriginal<typeof import("../channel")>();
  const hub = actual.createMemoryHub();
  return { ...actual, createBroadcastSyncChannel: vi.fn(() => hub.createChannel()) };
});
const runtimes: DisplayRuntime[] = [];
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.stop()); });

describe("browser display runtime", () => {
  it("uses no controller writer, reuses a canvas, and stops stale clients when the target changes", async () => {
    const { getDisplayRuntime, beginCanvasDrag } = await import("../browserRuntime");
    const first = await getDisplayRuntime("one"); runtimes.push(first);
    expect(await getDisplayRuntime("one")).toBe(first);
    expect(beginCanvasDrag("missing")).toBeNull();
    const second = await getDisplayRuntime("two"); runtimes.push(second);
    expect(second).not.toBe(first);
    expect(first.getStatus().canInteract).toBe(false);
    second.stop();
    const restarted = await getDisplayRuntime("two"); runtimes.push(restarted);
    expect(restarted).not.toBe(second);
  });

  it("does not let a late IndexedDB read replace a newer owner snapshot", async () => {
    const { openVivicDB } = await import("@/persistence/db");
    const { createBroadcastSyncChannel, flushChannel } = await import("../channel");
    const { getDisplayRuntime } = await import("../browserRuntime");
    const { emptyVivicState, toCanvasRecord } = await import("@/persistence/canvasRecord");
    const db = createMemoryDB(), stale = toCanvasRecord("late", "old", 0, emptyVivicState());
    let release!: () => void;
    db.getCanvas = async () => { await new Promise<void>(resolve => { release = resolve; }); return stale; };
    vi.mocked(openVivicDB).mockResolvedValueOnce(db);
    const puts = vi.spyOn(db, "putCanvas"), metas = vi.spyOn(db, "setMeta");
    const starting = getDisplayRuntime("late"); await Promise.resolve(); await Promise.resolve();
    const owner = createBroadcastSyncChannel();
    const snapshot: SyncMessage = { type: "snapshot", canvasId: "late", epoch: "new-owner", version: 3, seq: 1, requestId: "new-snapshot",
      payload: { title: "current", version: 3, preferences: { theme: "dark", reducedMotion: true, subtitles: false },
        vivicState: { ...emptyVivicState(), viewport: { x: 32, y: 44, zoom: 0.7 } } } };
    owner.post(snapshot); await flushChannel(); release();
    const runtime = await starting; runtimes.push(runtime);
    expect(runtime.getStatus().version).toBe(3);
    expect(canvasStore.getState().viewport).toEqual({ x: 32, y: 44, zoom: 0.7 });
    expect(canvasStore.getPreferences().reducedMotion).toBe(true);
    expect(puts).not.toHaveBeenCalled(); expect(metas).not.toHaveBeenCalled(); owner.close();
  });
});
