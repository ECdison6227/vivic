import { expect, test } from "@playwright/test";
import path from "node:path";
import { EVIDENCE, fire } from "./helpers";

/**
 * Phase 2a.1 (FIX A): the transient feedback orb must not overlap cards.
 * One card is deliberately parked over the historical fixed orb spot
 * (bottom-center ~21vh); the orb must anchor somewhere intersection-free.
 */
test("P2a.1: feedback orb avoids card rects", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/display");
  await page.waitForSelector(".siri-orb");
  await fire(page, "boot", [
    { type: "stage.awaken" },
    { type: "card.create", card: {
      id: "p2a1-todo",
      type: "TodoCard",
      variant: "minimal",
      displayProps: {
        items: [
          { id: "p2a1-i1", text: "占位任务甲", done: false },
          { id: "p2a1-i2", text: "占位任务乙", done: false },
        ],
      },
      sourceData: {},
      sources: [],
      layout: { x: 0, y: 0, width: 288, height: 160, pinned: false },
      metadata: { createdAt: "2026-10-15T08:00:00.000Z", updatedAt: "2026-10-15T08:00:00.000Z" },
    } },
  ]);
  await page.waitForSelector('[data-vivic-stage="WORKSPACE"]', { timeout: 6000 });
  await fire(page, "fit", [{ type: "canvas.fit" }]);
  await page.waitForTimeout(900); // camera settles, store.viewport authoritative

  // Park the card over the historical orb spot: (w/2, h - 21vh).
  const spot = { x: 400, y: 600 - 126 };
  const vp = await page.evaluate(
    () =>
      (window as unknown as {
        __vivic: { getState: () => { viewport: { x: number; y: number; zoom: number } } };
      }).__vivic.getState().viewport,
  );
  const z = vp.zoom || 1;
  // Layout is now owner-controlled. Recreate this explicitly pinned TEST card
  // through the validated engine instead of a removed internal mutation hook.
  const record = await page.evaluate(() => (window.__vivic!.getState() as {
    cards: Array<{ record: Record<string, unknown> }>;
  }).cards.find(entry => entry.record.id === "p2a1-todo")!.record);
  await fire(page, "remove-old-test-position", [{ type: "card.delete", targetId: "p2a1-todo" }]);
  await expect(page.locator('[data-card-id="p2a1-todo"]')).toHaveCount(0);
  await fire(page, "park-test-card", [{ type: "card.create", card: { ...record,
    layout: { x: (spot.x - vp.x) / z - 144, y: (spot.y - vp.y) / z - 80, width: 288, height: 160, pinned: true },
  } }]);
  await page.waitForTimeout(600);

  // Trigger the transient feedback orb.
  await fire(page, "speak", [
    { type: "subtitle.show", text: "找到它了", durationMs: 4000 },
  ]);
  const orb = page.locator("[data-vivic-orb-anchor]");
  await expect(orb).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(700);

  const orbBox = await orb.boundingBox();
  expect(orbBox).not.toBeNull();
  const cardBox = await page.locator('[data-card-id="p2a1-todo"]').boundingBox();
  expect(cardBox).not.toBeNull();
  const overlap =
    orbBox!.x < cardBox!.x + cardBox!.width &&
    orbBox!.x + orbBox!.width > cardBox!.x &&
    orbBox!.y < cardBox!.y + cardBox!.height &&
    orbBox!.y + orbBox!.height > cardBox!.y;
  expect(overlap).toBe(false);
  // And the orb stays fully on screen.
  expect(orbBox!.x).toBeGreaterThanOrEqual(0);
  expect(orbBox!.y).toBeGreaterThanOrEqual(0);
  expect(orbBox!.x + orbBox!.width).toBeLessThanOrEqual(800);
  expect(orbBox!.y + orbBox!.height).toBeLessThanOrEqual(600);
  await page.screenshot({ path: path.join(EVIDENCE, "../phase2a/orb-avoids-cards.png") });
});
