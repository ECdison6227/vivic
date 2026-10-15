import { z } from "zod";
import type { StepfunCredential } from "./credentials.js";
import type { StepfunDeps } from "./stepfun.js";
import { SPEECH_MODEL } from "./speech.js";
export const CloneVoiceIdSchema = z.string().regex(/^voice-[A-Za-z0-9_-]{1,100}$/);
export const CloneVoiceRequestSchema = z.strictObject({
  fileId: z.string().regex(/^file-[A-Za-z0-9_-]{1,100}$/),
  text: z.string().max(500).regex(/^[^\p{Cc}\p{Cf}]*$/u).trim().optional(),
  authorized: z.literal(true),
});
export async function cloneVoice(credential: StepfunCredential, input: z.infer<typeof CloneVoiceRequestSchema>, deps: StepfunDeps, parent: AbortSignal) {
  const base = deps.baseUrl.replace(/\/+$/, ""), url = new URL(base);
  // Exactly the documented Plan route. Local fixtures remain available for tests.
  if (!((url.protocol === "https:" && ["api.stepfun.com", "api.stepfun.ai"].includes(url.hostname) && url.pathname === "/step_plan/v1" && !url.search && !url.hash && !url.username && !url.password)
    || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw new Error("复刻音色只支持 StepFun Plan 接口。");
  const signal = AbortSignal.any([parent, AbortSignal.timeout(deps.timeoutMs ?? 15000)]);
  const response = await (deps.fetchImpl ?? fetch)(`${base}/audio/voices`, { method: "POST", redirect: "error", signal,
    headers: { authorization: `Bearer ${credential.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: SPEECH_MODEL, file_id: input.fileId, ...(input.text ? { text: input.text } : {}) }) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Plan 音色复刻请求被拒绝，请检查文件、套餐权限和额度。"); }
  if (!response.body || !response.headers.get("content-type")?.includes("application/json")) { await response.body?.cancel(); throw new Error("复刻音色返回格式无效。"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error("复刻音色返回过大。"); } chunks.push(chunk.value);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return z.object({ id: CloneVoiceIdSchema, object: z.literal("audio.voice") }).parse(raw).id;
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
