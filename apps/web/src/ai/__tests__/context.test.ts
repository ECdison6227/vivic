import { expect, it } from "vitest";
import { buildCanvasContext } from "../api";
import { emptyVivicState } from "@/persistence/canvasRecord";
import { testCards } from "@/cards/__tests__/fixtures";
it("omits credential-shaped source fields regardless of case, and bounds retained article context", () => {
  const state = { ...emptyVivicState(), cards: [{ record: { ...testCards.NoteCard, sourceData: {
    apiKey: "TEST-not-a-real-key", APIKEY: "TEST-uppercase", Token: "TEST-token", SECRET: "TEST-secret",
    articleText: "TEST ".repeat(1000), provenance: "TEST verified source",
  } } }] };
  const context = buildCanvasContext(state, "TEST");
  expect(context.cards[0]!.sourceDataSummary).toEqual({ articleText: "[5000 chars, retained on the source card]", provenance: "TEST verified source" });
});
