import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createModels, type CredentialStore, type AuthPrompt, type AuthEvent, type Model, type Api } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { ChatMessage, StepfunResult } from "../stepfun.js";
import { gptFetch, GPT_MODELS, GPT_RESPONSES, CODEX_RESPONSES, GptTransportError } from "./transport.js";

type Route = "openai" | "openai-codex";
// Pi 1.2 does not re-export AuthStorage. Load this exact pinned implementation
// alone rather than importing its CLI/session/tool registry barrel.
let authStorageModule: Promise<{ AuthStorage: { create: (path: string) => CredentialStore } }> | undefined;
const loadStorage = () => authStorageModule ??= import(new URL("./core/auth-storage.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
export type GptSource = "pi" | "vivic";
const routes: Route[] = ["openai", "openai-codex"];
const OAuth = z.object({ type: z.literal("oauth"), access: z.string().min(1), refresh: z.string().min(1), expires: z.number().finite() }).passthrough();
const id = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
const PREFERRED = ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-6-sol", "gpt-6.1-sol"];

/** Only OAuth for the two Pi GPT routes. No command/API-key config resolution. */
function oauthStorage(storage: CredentialStore): CredentialStore {
  const allowed = (provider: string) => { if (!routes.includes(provider as Route)) throw new Error("Provider disabled"); };
  return {
    async read(provider, options) { allowed(provider); const value = await storage.read(provider, options); return OAuth.safeParse(value).success ? value : undefined; },
    async list(options) { return (await storage.list(options)).filter(value => routes.includes(value.providerId as Route) && value.type === "oauth"); },
    async modify(provider, work, options) { allowed(provider); return storage.modify(provider, async value => {
      const result = await work(OAuth.safeParse(value).success ? value : undefined);
      if (result !== undefined && !OAuth.safeParse(result).success) throw new Error("Only OAuth is supported");
      return result;
    }, options); },
    async delete(provider, options) { allowed(provider); return storage.delete(provider, options); },
  };
}
function runtime(storage: CredentialStore) {
  const models = createModels({ credentials: oauthStorage(storage), authContext: { env: async () => undefined, fileExists: async () => false } });
  for (const provider of [openaiProvider(), openaiCodexProvider()]) models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } });
  return models;
}
type Runtime = ReturnType<typeof runtime>;
interface Connection { runtime: Runtime; storage: CredentialStore; source: GptSource; route: Route; model: Model<Api>; models: Model<Api>[]; }
export interface GptStatus {
  name: "gpt"; connected: boolean; capabilities: string[]; models?: string[]; defaultModel?: string;
  source?: GptSource; route?: Route; checkedAt?: string; lastError?: string;
}
interface LoginState { phase: "idle" | "waiting" | "verifying" | "connected" | "error"; authUrl?: string; needsInput?: boolean; prompt?: string; error?: string; }
export interface GptDeps { fetchImpl?: typeof fetch; ownStorage?: CredentialStore; piStorage?: CredentialStore; authDir?: string; piAuthPath?: string; }

/** Pi handles OAuth, token refresh and model requests. No agent session exists. */
export class GptProvider {
  #deps: GptDeps;
  #connection?: Connection;
  #version = 0;
  #checkedAt?: string;
  #error?: string;
  #login: LoginState = { phase: "idle" };
  #loginAbort?: AbortController;
  #input?: { resolve: (value: string) => void; reject: () => void; };
  #requests = new Set<AbortController>();
  constructor(deps: GptDeps = {}) { this.#deps = deps; }
  status(): GptStatus {
    const c = this.#connection;
    return { name: "gpt", connected: Boolean(c), capabilities: ["chat", "structured", ...(c?.model.input.includes("image") ? ["vision"] : [])],
      ...(c ? { models: c.models.map(model => model.id), defaultModel: c.model.id, source: c.source, route: c.route, checkedAt: this.#checkedAt } : {}),
      ...(this.#error ? { lastError: this.#error } : {}) };
  }
  loginStatus() { return { ...this.#login }; }
  generation() { return this.#version; }
  isCurrent(version: number) { return version === this.#version && Boolean(this.#connection); }
  async #storage(source: GptSource): Promise<CredentialStore> {
    if (source === "vivic") return this.#deps.ownStorage ?? (await loadStorage()).AuthStorage.create(join(this.#deps.authDir ?? join(homedir(), ".vivic"), "auth.json"));
    if (this.#deps.piStorage) return this.#deps.piStorage;
    const path = this.#deps.piAuthPath ?? join(homedir(), ".pi", "agent", "auth.json");
    if (!existsSync(path)) throw new Error("Pi login not found");
    return (await loadStorage()).AuthStorage.create(path);
  }
  #invalidate() {
    this.#version++;
    this.#connection = undefined;
    for (const request of this.#requests) request.abort();
    this.#requests.clear();
  }
  async connect(source: GptSource, requestedModel?: string): Promise<boolean> {
    this.cancelLogin(); this.#invalidate(); this.#error = undefined;
    const version = this.#version;
    const controller = new AbortController(); this.#requests.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    let phase = "读取 Pi 登录";
    let httpStatus: number | undefined;
    let detail: string | undefined;
    try {
      const storage = await this.#storage(source);
      const models = runtime(storage);
      const route = (await Promise.all(routes.map(async name => ({ name, value: await models.checkAuth(name, { signal }) })))).find(item => item.value?.type === "oauth")?.name;
      if (!route) throw new Error("Pi login not found");
      phase = "刷新 GPT 授权";
      let available = [...await models.getAvailable(route, { signal })];
      if (route === "openai") {
        const auth = await models.getAuth(route, { signal });
        if (!auth?.auth.apiKey) throw new Error("GPT not authorized");
        phase = "读取 GPT 模型目录";
        const getCatalog = async () => {
          for (let attempt = 0; ; attempt++) {
            try {
              const result = await gptFetch(this.#deps.fetchImpl, status => { httpStatus = status; })(GPT_MODELS, { headers: { authorization: `Bearer ${auth.auth.apiKey}` }, signal });
              if (attempt === 0 && [502, 503, 504].includes(result.status)) { void result.body?.cancel(); continue; }
              return result;
            } catch (error) {
              if (attempt > 0 || signal.aborted || error instanceof GptTransportError) throw error;
              // One retry for this read-only catalog only, sharing the existing
              // deadline. Model inference is never automatically duplicated.
            }
          }
        };
        const response = await getCatalog();
        if (!response.ok) { void response.body?.cancel(); throw new Error("Model catalog unavailable"); }
        const catalog = z.union([
          z.object({ models: z.array(z.object({ slug: z.string().max(256), visibility: z.string().nullable().optional() })).max(2000) })
            .transform(value => value.models.filter(row => row.visibility === undefined || row.visibility === "list").map(row => row.slug)),
          z.object({ data: z.array(z.object({ id: z.string().max(256) })).max(2000) }).transform(value => value.data.map(row => row.id)),
        ]).safeParse(await response.json());
        if (!catalog.success) throw new Error("Model catalog unavailable");
        available = [...new Set(catalog.data)].filter(name => id.safeParse(name).success && /^(?:gpt-|o[134])/.test(name)
          && !/audio|realtime|tts|transcrib|image|search|embedding|moderation/i.test(name)).map(name => {
          const known = models.getModel(route, name);
          const fallback = available.find(model => model.id === "gpt-6-luna") ?? available[0];
          if (!fallback) throw new Error("Model catalog empty");
          return known ?? { ...fallback, id: name, name, input: ["text"] as ("text" | "image")[] };
        });
      }
      if (!available.length) throw new Error("Model catalog empty");
      const model = requestedModel ? available.find(item => item.id === requestedModel)
        : PREFERRED.map(name => available.find(item => item.id === name)).find(Boolean) ?? available[0];
      if (!model) throw new Error("Requested model unavailable");
      const connection: Connection = { runtime: models, storage, route, source, model, models: available };
      phase = "验证 GPT 推理"; httpStatus = undefined;
      const probe = await this.#complete(connection, [{ role: "system", content: '只输出JSON {"ok":true}。' }, { role: "user", content: "测试连接" }], signal);
      if (!probe.ok) { httpStatus = probe.status; detail = probe.error; throw new Error("GPT inference unavailable"); }
      if ((probe.value as { ok?: boolean })?.ok !== true) throw new Error("GPT inference unavailable");
      signal.throwIfAborted();
      if (version !== this.#version) return false;
      this.#connection = connection; this.#checkedAt = new Date().toISOString();
      return true;
    } catch {
      if (version === this.#version) this.#error = `${phase}失败${httpStatus ? `（HTTP ${httpStatus}）` : ""}。${detail ?? "请检查 Pi 登录、账号模型权限与套餐额度；也可重新登录。"}`;
      return false;
    } finally { this.#requests.delete(controller); }
  }
  async #complete(connection: Connection, messages: ChatMessage[], signal: AbortSignal): Promise<StepfunResult<unknown>> {
    try {
      let completed = false;
      let httpStatus: number | undefined;
      const result = await connection.runtime.complete(connection.model, { messages: messages.map(message => message.role === "user" ? {
        role: "user" as const, timestamp: Date.now(), content: message.images?.length
          ? [{ type: "text" as const, text: message.content }, ...message.images.map(image => ({ type: "image" as const, data: image.data, mimeType: image.mime }))]
          : message.content,
      } : { role: "system" as const, content: message.content, timestamp: Date.now() }) }, {
        signal, timeoutMs: 45_000, maxRetries: 0, fetch: gptFetch(this.#deps.fetchImpl, status => { httpStatus = status; }),
        onPayload(payload) {
          const value = { ...(payload as Record<string, unknown>), store: false, stream: true };
          for (const key of ["tools", "tool_choice", "max_output_tokens", "temperature", "top_p", "metadata", "background", "previous_response_id", "conversation", "prompt_cache_retention", "safety_identifier"]) delete (value as Record<string, unknown>)[key];
          return { ...value, text: { format: { type: "json_object" } } };
        },
        onProviderStreamEvent(event) {
          if (event && typeof event === "object" && "type" in event && event.type === "response.completed" && "response" in event && event.response && typeof event.response === "object") {
            completed = "status" in event.response && event.response.status === "completed" && !("error" in event.response && event.response.error);
          }
        },
        ...(connection.route === "openai-codex" ? { transport: "sse" as const } : {}),
      });
      signal.throwIfAborted();
      if (!completed || result.stopReason !== "stop") return { ok: false, code: "provider", status: httpStatus, error: "GPT 未完整完成推理，请检查登录或额度后重试" };
      const text = result.content.filter(part => part.type === "text").map(part => part.text).join("");
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, code: signal.aborted ? "cancelled" : "invalid-response", error: signal.aborted ? "GPT 请求已取消或超时" : "GPT 未返回可验证的 JSON 结果" };
    }
  }
  async generate(messages: ChatMessage[], parent?: AbortSignal): Promise<StepfunResult<unknown>> {
    const c = this.#connection; if (!c) return { ok: false, code: "provider", error: "GPT 未连接" };
    const version = this.#version; const controller = new AbortController(); this.#requests.add(controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000), ...(parent ? [parent] : [])]);
    try {
      const result = await this.#complete(c, messages, signal);
      return this.isCurrent(version) ? result : { ok: false, code: "cancelled", error: "GPT 连接已变更，旧结果已丢弃" };
    } finally { this.#requests.delete(controller); }
  }
  /** Auth remains private; supplied work must call a fixed provider endpoint. */
  async withSearchAuth<T>(work: (input: { url: string; apiKey: string; model: string; headers: Record<string, string> }) => Promise<T>, signal: AbortSignal): Promise<T> {
    const c = this.#connection; const version = this.#version;
    if (!c) throw new Error("GPT disconnected");
    const auth = await c.runtime.getAuth(c.model, { signal });
    if (!auth?.auth.apiKey) throw new Error("GPT disconnected");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(auth.auth.headers ?? {})) if (typeof value === "string") headers[key] = value;
    if (c.route === "openai-codex") {
      // Same auth claim/header mapping used by Pi and pi-web-access. This only
      // routes an already validated Pi credential; it is not JWT verification.
      const claims = JSON.parse(Buffer.from(auth.auth.apiKey.split(".")[1] ?? "", "base64url").toString("utf8"));
      const accountId = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
      if (typeof accountId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(accountId)) throw new Error("Missing GPT account claim");
      headers["chatgpt-account-id"] = accountId;
      headers["OpenAI-Beta"] = "responses=experimental";
      headers.originator = "pi";
    }
    const result = await work({ url: c.route === "openai" ? GPT_RESPONSES : CODEX_RESPONSES,
      apiKey: auth.auth.apiKey, model: c.model.id, headers });
    if (!this.isCurrent(version)) throw new Error("GPT connection changed");
    return result;
  }
  async startLogin() {
    this.cancelLogin(); this.#invalidate(); this.#error = undefined;
    const controller = new AbortController(); this.#loginAbort = controller;
    const version = this.#version;
    this.#login = { phase: "waiting" };
    const storage = await this.#storage("vivic"); const models = runtime(storage);
    const notify = (event: AuthEvent) => {
      if (version !== this.#version) return;
      if (event.type === "auth_url") {
        const url = new URL(event.url);
        if (url.origin !== "https://auth.openai.com") { controller.abort(); return; }
        this.#login = { ...this.#login, authUrl: url.href };
      }
    };
    void models.login("openai", "oauth", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]), notify,
      prompt: (prompt: AuthPrompt) => new Promise<string>((resolve, reject) => {
        if (prompt.type !== "manual_code") { reject(new Error("Unexpected OAuth prompt")); return; }
        const signal = AbortSignal.any([controller.signal, ...(prompt.signal ? [prompt.signal] : [])]);
        const abort = () => { this.#input = undefined; reject(new Error("Login cancelled")); };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        this.#login = { ...this.#login, needsInput: true, prompt: "在浏览器完成授权；若未自动返回，可粘贴完整回调地址。" };
        this.#input = { resolve: value => { signal.removeEventListener("abort", abort); this.#input = undefined; resolve(value); }, reject: abort };
      }),
    }, { agentName: "Vivic", getDeviceId: () => {
      const dir = this.#deps.authDir ?? join(homedir(), ".vivic"); mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, "device-id");
      const current = existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
      if (current && z.uuid().safeParse(current).success) return current;
      const value = randomUUID(); writeFileSync(path, value, { mode: 0o600 }); return value;
    } }).then(async () => {
      if (version !== this.#version || controller.signal.aborted) return;
      this.#loginAbort = undefined; this.#login = { phase: "verifying" };
      const ok = await this.connect("vivic");
      this.#login = ok ? { phase: "connected" } : { phase: "error", error: this.#error };
    }).catch(() => {
      if (version === this.#version && !controller.signal.aborted) this.#login = { phase: "error", error: "GPT 登录未完成。请重试；如本机已有 Pi 登录，可直接使用。回调端口 1455 需可用。" };
    });
    return this.loginStatus();
  }
  provideLoginInput(value: string) { if (!this.#input) return false; this.#input.resolve(value); this.#login = { ...this.#login, needsInput: false }; return true; }
  cancelLogin() { this.#loginAbort?.abort(); this.#loginAbort = undefined; this.#input?.reject(); this.#input = undefined; this.#login = { phase: "idle" }; }
  async disconnect() {
    const c = this.#connection; this.cancelLogin(); this.#invalidate(); this.#error = undefined;
    // Disconnecting a reused Pi login must not sign the user's Pi CLI out.
    if (c?.source === "vivic") await c.storage.delete(c.route);
  }
}
