import { describe, expect, it } from "vitest";
import { ActionEnvelopeSchema } from "@vivic/contracts";
import { CredentialStore } from "../../src/credentials.js";
import { runIntent } from "../../src/intent/pipeline.js";
import { emptyContext } from "../helpers.js";
import { chatJson, validateKey } from "../../src/stepfun.js";
import { STEPFUN_PLAN_BASE_URL } from "../../src/config.js";

/**
 * LIVE StepFun roundtrip. BLOCKED until the user's key exists:
 *
 *   STEPFUN_KEY=sk-... pnpm --filter @vivic/local-api test:live
 *
 * No mocking anywhere in this file. A red test here means the provider call
 * really failed — never fake this green.
 */
const KEY = process.env.STEPFUN_KEY;
const live = KEY ? describe : describe.skip;

const BASE = process.env.STEPFUN_BASE_URL ?? STEPFUN_PLAN_BASE_URL;

live("StepFun live connection (requires STEPFUN_KEY)", () => {
  it("validateKey performs a real connection test", async () => {
    const res = await validateKey(KEY!, { baseUrl: BASE });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.models.length).toBeGreaterThan(0);
      console.log(
        "[live] models:",
        res.value.models.slice(0, 8).join(", "),
        "| default:",
        res.value.defaultModel,
      );
    }
  });

  it("one real intent roundtrip returns a schema-valid envelope", async () => {
    const validated = await validateKey(KEY!, { baseUrl: BASE });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const credentials = new CredentialStore();
    credentials.set({ apiKey: KEY!, ...validated.value });

    const result = await runIntent(
      {
        text: "帮我把左边的倒计时放大一点",
        canvasContext: {
          ...emptyContext(),
          cards: [
            {
              id: "cd-live",
              type: "CountdownCard",
              displayProps: {},
              sourceDataSummary: { targetAt: new Date(Date.now() + 600_000).toISOString() },
              layout: { x: 0, y: 0 },
            },
          ],
        },
      },
      { credentials, stepfun: { baseUrl: BASE, timeoutMs: 20_000 } },
    );
    console.log("[live] intent kind:", result.kind, "| message:", result.message ?? "-");
    expect(["envelope", "clarify"]).toContain(result.kind);
    if (result.kind === "envelope") {
      expect(ActionEnvelopeSchema.safeParse(result.envelope).success).toBe(true);
    }
  });

  it("chatJson JSON-mode is honored by the provider", async () => {
    const validated = await validateKey(KEY!, { baseUrl: BASE });
    if (!validated.ok) throw new Error(validated.error);
    const res = await chatJson(
      { apiKey: KEY!, ...validated.value },
      [
        { role: "system", content: "只输出 JSON。" },
        { role: "user", content: '返回 {"pong": true}' },
      ],
      { baseUrl: BASE, timeoutMs: 20_000 },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.value as { pong?: boolean }).pong).toBe(true);
    }
  });
});
