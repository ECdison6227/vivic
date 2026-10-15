import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { CredentialStore } from "../src/credentials.js";
import { STEPFUN_PLAN_BASE_URL } from "../src/config.js";
import { authed, testConfig } from "./helpers.js";
const setup = (base = STEPFUN_PLAN_BASE_URL) => {
  const credentials = new CredentialStore(); credentials.set({ apiKey: "TEST-clone-key", defaultModel: "step-3.5-flash", models: ["step-3.5-flash"], checkedAt: "TEST" });
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    if (JSON.parse(String(init?.body)).file_id) return Response.json({ id: "voice-tone-TEST", object: "audio.voice" });
    return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
  });
  const app = createApp({ config: testConfig({ stepfunBaseUrl: base }), credentials, fetchImpl });
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: authed, body: JSON.stringify(body) });
  return { app, credentials, fetchImpl, post };
};
describe("explicit Plan-only voice cloning from an already uploaded file", () => {
  it("requires authorization and validates file id before any upstream request", async () => {
    const { post, fetchImpl } = setup();
    for (const body of [{ fileId: "file-TEST" }, { fileId: "http://localhost/a", authorized: true }, { fileId: "file-TEST", authorized: false }, { fileId: "file-TEST", authorized: true, model: "unapproved" }]) expect((await post("/api/speech/cloned-voices", body)).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses the documented Plan route once and accepts only confirmed current-connection voices for TTS", async () => {
    const { app, post, fetchImpl, credentials } = setup();
    expect((await post("/api/speech", { text: "TEST", clonedVoiceId: "voice-tone-TEST" })).status).toBe(400);
    const response = await post("/api/speech/cloned-voices", { fileId: "file-TEST", text: "TEST 原文", authorized: true });
    expect(await response.json()).toEqual({ ok: true, id: "voice-tone-TEST" });
    expect(fetchImpl.mock.calls[0]![0]).toBe(`${STEPFUN_PLAN_BASE_URL}/audio/voices`);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ model: "stepaudio-2.5-tts", file_id: "file-TEST", text: "TEST 原文" });
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe("error");
    expect((await post("/api/speech", { text: "TEST", clonedVoiceId: "voice-tone-TEST" })).status).toBe(200);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body)).voice).toBe("voice-tone-TEST");
    credentials.clear(); expect(await (await app.request("/api/speech/cloned-voices", { headers: authed })).json()).toEqual({ voices: [] });
  });
  it("does not use ordinary paid API routes or echo upstream data", async () => {
    const { post, fetchImpl } = setup("https://api.stepfun.com/v1");
    expect((await post("/api/speech/cloned-voices", { fileId: "file-TEST", authorized: true })).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
