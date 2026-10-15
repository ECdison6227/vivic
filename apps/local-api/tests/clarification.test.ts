import { describe, expect, it } from "vitest";
import { runIntent } from "../src/intent/pipeline.js";
import { CredentialStore } from "../src/credentials.js";
import { IntentRequestSchema } from "../src/schemas.js";
import { emptyContext, chatOk } from "./helpers.js";

describe("one-turn clarification continuation", () => {
  it("resolves an answer against the original delete request rather than creating a new timer", async () => {
    const credentials = new CredentialStore();
    credentials.set({ apiKey: "TEST-private-clarification", defaultModel: "step-3.5-flash", models: ["step-3.5-flash"], checkedAt: new Date().toISOString() });
    const input = { text: "五分钟倒计时", continuation: { utterance: "删除那个提醒", question: "你要删除哪个时长的提醒？" },
      canvasContext: emptyContext([{ id: "five-minute", type: "CountdownCard", displayProps: {}, sourceDataSummary: { targetAt: new Date(Date.now() + 300000).toISOString() }, layout: { x: 0, y: 0 } }]) };
    let calls = 0;
    const result = await runIntent(input, { credentials, stepfun: { baseUrl: "https://unit.test", fetchImpl: async (_url, init) => {
      calls++; const payload = JSON.parse(String(init?.body)); const message = JSON.parse(payload.messages[1].content);
      expect(message.clarification).toEqual(input.continuation); expect(message.utterance).toBe("五分钟倒计时");
      return chatOk({ actions: [{ type: "card.delete", targetId: "five-minute" }] });
    } } });
    expect(calls).toBe(1); expect(result.kind).toBe("envelope");
    expect(result.envelope?.actions).toEqual([{ type: "card.delete", targetId: "five-minute" }]);
  });
  it("rejects credential/config/extra fields in the continuation contract", () => {
    expect(IntentRequestSchema.safeParse({ text: "第一个", canvasContext: emptyContext(),
      continuation: { utterance: "删除那个", question: "哪一个？", apiKey: "TEST never prompt" } }).success).toBe(false);
  });
});
