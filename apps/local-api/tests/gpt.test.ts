import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore, type OAuthCredential } from "@earendil-works/pi-ai";
import { GptProvider } from "../src/gpt/provider.js";
import { searchGpt } from "../src/gpt/search.js";
import { CODEX_RESPONSES, completedResponse, gptFetch, GPT_MODELS, GPT_RESPONSES, MAX_GPT_RESPONSE_BYTES } from "../src/gpt/transport.js";

// TEST fixtures only. Real Pi model/auth resolution and SSE parsing run. Most
// tests inject memory storage; disk-entry regressions use isolated temp files
// and the real AuthStorage loader. Never use user auth, login, or servers.
const ACCESS = "TEST-access-private";
const REFRESH = "TEST-refresh-private";
const MODEL = "gpt-test-text";
// Contract limit for the fixed catalog endpoint; all inference/search streams
// retain the separately imported 512 KiB response limit.
const CATALOG_LIMIT_BYTES = 4 * 1024 * 1024;
const credential = (access = ACCESS): OAuthCredential => ({ type: "oauth", access, refresh: REFRESH, expires: Date.UTC(2100, 0, 1) });
const frame = (event: Record<string, unknown>) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
const eventResponse = (events: Record<string, unknown>[]) => new Response(events.map(frame).join(""), { headers: { "content-type": "text/event-stream" } });
// A string Response would automatically add text/plain. Use a byte stream to
// model the real HTTP 200 boundary where Content-Type is genuinely absent.
const responseWithoutType = (wire: string) => {
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let index = 0; index < bytes.length; index += 13) controller.enqueue(bytes.slice(index, index + 13));
    controller.close();
  } }));
};

function piSse(value: unknown, terminal: "response.completed" | "response.incomplete" | "none" = "response.completed") {
  const text = JSON.stringify(value);
  const item = { id: "msg_TEST", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  const events: Record<string, unknown>[] = [
    { type: "response.created", response: { id: "resp_TEST", status: "in_progress" } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", output_index: 0, content_index: 0, text },
    { type: "response.output_item.done", output_index: 0, item },
  ];
  if (terminal !== "none") events.push({ type: terminal, response: { id: "resp_TEST", status: terminal === "response.completed" ? "completed" : "incomplete", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, ...(terminal === "response.incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}) } });
  return eventResponse(events);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(options: { route?: "openai" | "openai-codex"; own?: boolean; slugs?: string[]; access?: string } = {}) {
  const ownStorage = new InMemoryCredentialStore();
  const piStorage = new InMemoryCredentialStore();
  const source: "vivic" | "pi" = options.own ? "vivic" : "pi";
  await (options.own ? ownStorage : piStorage).modify(options.route ?? "openai", async () => credential(options.access));
  let respond: (body: Record<string, unknown>, init?: RequestInit) => Response | Promise<Response> = () => piSse({ ok: true });
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === GPT_MODELS) return Response.json({ models: (options.slugs ?? [MODEL, "gpt-test-other"]).map(slug => ({ slug, visibility: "list" })) });
    if (url === GPT_RESPONSES || url === CODEX_RESPONSES) {
      const text = new Headers(init?.headers).get("content-encoding") === "zstd"
        ? zstdDecompressSync(Buffer.from(init!.body as Uint8Array)).toString("utf8")
        : String(init?.body);
      return respond(JSON.parse(text), init);
    }
    throw new Error(`Unexpected TEST endpoint: ${url}`);
  });
  const gpt = new GptProvider({ ownStorage, piStorage, fetchImpl });
  return { gpt, source, ownStorage, piStorage, fetchImpl, respond: (next: typeof respond) => { respond = next; } };
}

beforeEach(() => {
  // Catch accidental ambient refresh/network access; all valid OAuth fixtures
  // expire in 2100 and every intended model/search call uses injected fetch.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("TEST forbids ambient network"); }));
});
afterEach(() => {
  const networkCalls = vi.mocked(fetch).mock.calls.length;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  expect(networkCalls, "No test may attempt ambient HTTP/OAuth refresh").toBe(0);
});

describe("GPT provider through the real pinned Pi SDK", () => {
  it("loads real Pi AuthStorage via the ESM-only package export and an explicit temporary piAuthPath", async () => {
    const directory = mkdtempSync(join(tmpdir(), "vivic-TEST-gpt-auth-"));
    const piAuthPath = join(directory, "auth.json");
    const access = "TEST-disk-auth-access-only";
    const stored = JSON.stringify({ openai: credential(access) });
    writeFileSync(piAuthPath, stored, { encoding: "utf8", mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${access}`);
      if (url === GPT_MODELS) return Response.json({ models: [{ slug: MODEL, visibility: "list" }] });
      if (url === GPT_RESPONSES) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ model: MODEL, stream: true, store: false });
        expect(body).not.toHaveProperty("tools");
        return piSse({ ok: true });
      }
      throw new Error("Unexpected TEST disk-auth endpoint");
    });
    // Deliberately inject neither piStorage nor ownStorage: connect must use
    // production loadStorage()/AuthStorage.create(), not an in-memory shortcut.
    const gpt = new GptProvider({ piAuthPath, authDir: join(directory, "unused-vivic-auth"), fetchImpl });
    try {
      expect(await gpt.connect("pi", MODEL)).toBe(true);
      expect(gpt.status()).toMatchObject({ connected: true, source: "pi", route: "openai", defaultModel: MODEL });
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES]);
      expect(await gpt.generate([{ role: "user", content: "TEST disk-backed inference" }])).toEqual({ ok: true, value: { ok: true } });
      expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES, GPT_RESPONSES]);
      expect(JSON.stringify(gpt.status())).not.toMatch(/TEST-disk-auth-access-only|TEST-refresh-private/);
      await gpt.disconnect();
      // Reusing Pi is not a logout: the exact synthetic file remains intact.
      expect(readFileSync(piAuthPath, "utf8")).toBe(stored);
    } finally {
      await gpt.disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each(["missing", "malformed"] as const)("an explicit %s temporary Pi auth file fails closed without ambient fallback", async state => {
    const directory = mkdtempSync(join(tmpdir(), "vivic-TEST-gpt-invalid-auth-"));
    const piAuthPath = join(directory, "auth.json");
    if (state === "malformed") writeFileSync(piAuthPath, '{"PRIVATE_TEST_auth":', { encoding: "utf8", mode: 0o600 });
    const fetchImpl = vi.fn<typeof fetch>();
    const gpt = new GptProvider({ piAuthPath, authDir: join(directory, "unused-vivic-auth"), fetchImpl });
    try {
      expect(await gpt.connect("pi", MODEL)).toBe(false);
      expect(gpt.status().connected).toBe(false);
      expect(JSON.stringify(gpt.status())).not.toContain("PRIVATE_TEST_auth");
      expect(JSON.stringify(gpt.status())).not.toContain(piAuthPath);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await gpt.disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires listed catalog plus a completed JSON probe; never publishes OAuth secrets or coding tools", async () => {
    const f = await fixture();
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    expect(f.gpt.status()).toMatchObject({ name: "gpt", connected: true, source: "pi", route: "openai", defaultModel: MODEL, models: [MODEL, "gpt-test-other"] });
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES]);
    f.respond(() => piSse({ actions: [{ type: "subtitle.show", text: "TEST GPT" }] }));
    expect(await f.gpt.generate([{ role: "user", content: "TEST plain text" }])).toMatchObject({ ok: true, value: { actions: [{ type: "subtitle.show", text: "TEST GPT" }] } });
    for (const [url, init] of f.fetchImpl.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${ACCESS}`);
      if (String(url) !== GPT_RESPONSES) continue;
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ store: false, stream: true, model: MODEL, text: { format: { type: "json_object" } } });
      for (const key of ["tools", "tool_choice", "metadata", "background", "previous_response_id", "conversation"]) expect(body).not.toHaveProperty(key);
      expect(JSON.stringify(body)).not.toMatch(/"(?:bash|read|write|edit|computer|shell|mcp)"/);
    }
    expect(JSON.stringify([f.gpt.status(), f.gpt.loginStatus()])).not.toMatch(/TEST-access-private|TEST-refresh-private/);
    expect(fetch).not.toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it.each([false, "yes", 1, {}, []].map(ok => ({ ok })))("connect requires literal true, rejecting probe $ok", async ({ ok }) => {
    const f = await fixture();
    f.respond(() => piSse({ ok }));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.gpt.status().connected).toBe(false);
    await f.gpt.disconnect();
  });

  it.each(["none", "response.incomplete"] as const)("a %s stream with otherwise valid JSON never establishes a connection", async terminal => {
    const f = await fixture();
    f.respond(() => piSse({ ok: true }, terminal));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.gpt.status().connected).toBe(false);
  });

  it("hides non-list catalog models and rejects unknown model selection without a probe", async () => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => Response.json({ models: [{ slug: MODEL, visibility: "list" }, { slug: "gpt-test-hidden", visibility: "hidden" }] }));
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    expect(f.gpt.status().models).toEqual([MODEL]);
    f.fetchImpl.mockClear();
    expect(await f.gpt.connect("pi", "gpt-test-not-authorized")).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
  });

  it.each(["models", "data"] as const)("accepts the %s catalog shape, deduplicates safe chat IDs and excludes unsafe/media entries", async shape => {
    const f = await fixture();
    const ids = [MODEL, MODEL, "gpt-test-other", "o3", "gpt-test/unsafe", "gpt-test\nPRIVATE", "gpt-" + "a".repeat(129), "test-third-provider", "gpt-test-audio", "gpt-test-realtime", "gpt-test-tts", "gpt-test-transcribe", "gpt-image-1", "gpt-test-search", "text-embedding-3-small", "omni-moderation-latest"];
    const catalog = shape === "data"
      ? { object: "list", data: ids.map(id => ({ id, object: "model", owned_by: "TEST" })) }
      : { models: ids.map(slug => ({ slug, visibility: "list" })) };
    f.fetchImpl.mockImplementationOnce(async () => Response.json(catalog));
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    expect(f.gpt.status().models).toEqual([MODEL, "gpt-test-other", "o3"]);
    expect(f.gpt.status().defaultModel).toBe(MODEL);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES]);
    expect(JSON.parse(String(f.fetchImpl.mock.calls[1]![1]?.body))).toMatchObject({ model: MODEL });
    await f.gpt.disconnect();
  });

  it.each(["models", "data"] as const)("the %s catalog accepts 2000 entries and rejects 2001 before inference", async shape => {
    for (const count of [2000, 2001]) {
      const f = await fixture();
      const ids = Array.from({ length: count }, (_, index) => `gpt-test-catalog-${index}`);
      const catalog = shape === "data" ? { data: ids.map(id => ({ id })) } : { models: ids.map(slug => ({ slug, visibility: "list" })) };
      f.fetchImpl.mockImplementationOnce(async () => Response.json(catalog));
      expect(await f.gpt.connect("pi", ids[count - 1])).toBe(count === 2000);
      expect(f.gpt.status().connected).toBe(count === 2000);
      if (count === 2000) {
        expect(f.gpt.status().models).toHaveLength(2000);
        expect(f.gpt.status().defaultModel).toBe(ids[1999]);
        expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES]);
      } else expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
      await f.gpt.disconnect();
    }
  });

  it.each([
    { label: "unknown root", catalog: { catalog: [{ id: MODEL }] } },
    { label: "wrong models row", catalog: { models: [{ id: MODEL }] } },
    { label: "wrong data row", catalog: { data: [{ slug: MODEL }] } },
    { label: "null data", catalog: { data: null } },
    { label: "hidden only", catalog: { models: [{ slug: MODEL, visibility: "hidden" }] } },
    { label: "private visibility only", catalog: { models: [{ slug: MODEL, visibility: "private" }] } },
    { label: "media only", catalog: { data: [{ id: "gpt-test-audio" }] } },
    { label: "unsafe IDs only", catalog: { data: [{ id: "gpt-test/unsafe" }] } },
    { label: "empty data", catalog: { data: [] } },
  ])("catalog $label fails closed without a probe or invented model", async ({ catalog }) => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => Response.json(catalog));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.gpt.status().connected).toBe(false);
    expect(f.gpt.status().models).toBeUndefined();
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
  });

  it.each(["models", "data"] as const)("a rich nine-entry %s catalog above 512 KiB connects without adopting base_instructions", async shape => {
    const f = await fixture();
    const ids = [MODEL, ...Array.from({ length: 8 }, (_, index) => `gpt-test-rich-${index}`)];
    const instructions = `TEST_PROVIDER_BASE_INSTRUCTIONS ${"x".repeat(80 * 1024)}`;
    const catalog = shape === "models"
      ? { models: ids.map(slug => ({ slug, visibility: "list", base_instructions: instructions })) }
      : { data: ids.map(id => ({ id, base_instructions: instructions })) };
    const bytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
    expect(bytes).toBeGreaterThan(MAX_GPT_RESPONSE_BYTES);
    expect(bytes).toBeLessThan(CATALOG_LIMIT_BYTES);
    f.fetchImpl.mockImplementationOnce(async () => Response.json(catalog));
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    expect(f.gpt.status().models).toEqual(ids);
    expect(await f.gpt.generate([{ role: "user", content: "TEST original user instruction" }])).toMatchObject({ ok: true });
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_RESPONSES, GPT_RESPONSES]);
    for (const [url, init] of f.fetchImpl.mock.calls) {
      if (String(url) === GPT_RESPONSES) expect(String(init?.body)).not.toContain("TEST_PROVIDER_BASE_INSTRUCTIONS");
    }
    expect(JSON.stringify(f.gpt.status())).not.toContain("TEST_PROVIDER_BASE_INSTRUCTIONS");
    await f.gpt.disconnect();
  });

  it("a syntactically valid data catalog remains bounded by the 4 MiB catalog transport cap", async () => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => Response.json({ data: [{ id: MODEL }], TEST_padding: "x".repeat(CATALOG_LIMIT_BYTES) }));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.gpt.status().connected).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
  });

  it("rejects API-key credentials and third-party OAuth even with an ambient OpenAI API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "TEST-ambient-api-key");
    const ownStorage = new InMemoryCredentialStore();
    const piStorage = new InMemoryCredentialStore();
    await piStorage.modify("anthropic", async () => credential());
    await piStorage.modify("openai", async () => ({ type: "api_key", key: "TEST-not-OAuth" }));
    const fetchImpl = vi.fn<typeof fetch>();
    const gpt = new GptProvider({ ownStorage, piStorage, fetchImpl });
    expect(await gpt.connect("pi")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("disconnect isolates Pi versus Vivic credentials (own=%s)", async own => {
    const f = await fixture({ own });
    expect(await f.gpt.connect(f.source, MODEL)).toBe(true);
    await f.gpt.disconnect();
    expect(await f.piStorage.read("openai")).toEqual(own ? undefined : credential());
    expect(await f.ownStorage.read("openai")).toBeUndefined();
    expect(await f.gpt.generate([{ role: "user", content: "TEST" }])).toMatchObject({ ok: false, code: "provider" });
  });

  it("legacy Codex OAuth uses only its fixed SSE endpoint, never the OpenAI catalog or a WebSocket", async () => {
    const access = `TEST.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "TEST-account" } })).toString("base64url")}.TEST`;
    const f = await fixture({ route: "openai-codex", access });
    vi.stubGlobal("WebSocket", vi.fn(() => { throw new Error("TEST forbids WebSocket"); }));
    expect(await f.gpt.connect("pi")).toBe(true);
    expect(f.gpt.status().route).toBe("openai-codex");
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([CODEX_RESPONSES]);
    expect(WebSocket).not.toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it("disconnect aborts in-flight inference and drops a late completed response", async () => {
    const f = await fixture();
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    const entered = deferred<AbortSignal>();
    const late = deferred<Response>();
    f.respond((_body, init) => { entered.resolve(init!.signal!); return late.promise; });
    const pending = f.gpt.generate([{ role: "user", content: "TEST late" }]);
    const signal = await entered.promise;
    await f.gpt.disconnect();
    expect(signal.aborted).toBe(true);
    late.resolve(piSse({ actions: [{ type: "subtitle.show", text: "TEST stale" }] }));
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(f.gpt.status().connected).toBe(false);
  });

  it("an upstream function_call is rejected, never executed or continued as a coding tool", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const item = { type: "function_call", id: "TEST-call-item", call_id: "TEST-call", name: "bash", arguments: '{"command":"TEST never execute"}', status: "completed" };
    f.respond(() => eventResponse([
      { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
      { type: "response.function_call_arguments.delta", output_index: 0, delta: item.arguments },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id: "TEST-tool-response", status: "completed", output: [item] } },
    ]));
    const before = f.fetchImpl.mock.calls.length;
    expect(await f.gpt.generate([{ role: "user", content: "TEST" }])).toMatchObject({ ok: false, code: "provider" });
    expect(f.fetchImpl.mock.calls.length - before).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it("a model switch drops an old result while preserving the new verified connection", async () => {
    const f = await fixture();
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    const entered = deferred<void>();
    const late = deferred<Response>();
    f.respond(body => body.model === MODEL ? (entered.resolve(), late.promise) : piSse({ ok: true }));
    const pending = f.gpt.generate([{ role: "user", content: "TEST late" }]);
    await entered.promise;
    expect(await f.gpt.connect("pi", "gpt-test-other")).toBe(true);
    late.resolve(piSse({ actions: [{ type: "subtitle.show", text: "TEST stale" }] }));
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    expect(f.gpt.status()).toMatchObject({ connected: true, defaultModel: "gpt-test-other" });
    await f.gpt.disconnect();
  });

  it("a pending connect cannot resurrect a disconnected provider", async () => {
    const f = await fixture();
    const entered = deferred<void>();
    const late = deferred<Response>();
    f.respond(() => { entered.resolve(); return late.promise; });
    const pending = f.gpt.connect("pi", MODEL);
    await entered.promise;
    await f.gpt.disconnect();
    late.resolve(piSse({ ok: true }));
    expect(await pending).toBe(false);
    expect(f.gpt.status()).toMatchObject({ connected: false });
  });

  it.each([502, 503, 504, "network"] as const)("catalog GET retries %s exactly once using the original deadline signal", async failure => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => {
      if (failure === "network") throw new TypeError("TEST catalog network failure");
      return new Response("TEST temporary catalog failure", { status: failure });
    });
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_MODELS, GPT_RESPONSES]);
    const [first, second] = f.fetchImpl.mock.calls;
    expect(first![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(second![1]?.signal).toBe(first![1]?.signal);
    expect(first![1]?.method ?? "GET").toBe("GET");
    expect(second![1]?.method ?? "GET").toBe("GET");
    await f.gpt.disconnect();
  });

  it.each([503, "network"] as const)("catalog repeated %s failures stop after two GETs without inference", async failure => {
    const f = await fixture();
    f.fetchImpl.mockImplementation(async () => {
      if (failure === "network") throw new TypeError("PRIVATE_TEST network failure");
      return new Response("PRIVATE_TEST gateway failure", { status: failure });
    });
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS, GPT_MODELS]);
    expect(JSON.stringify(f.gpt.status())).not.toContain("PRIVATE_TEST");
  });

  it.each([401, 403, 429, 500])("catalog HTTP %s is not silently retried", async status => {
    const f = await fixture();
    f.fetchImpl.mockImplementationOnce(async () => new Response("TEST catalog rejection", { status }));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
  });

  it("an expired shared connect deadline prevents the second catalog GET", async () => {
    const f = await fixture();
    const deadline = new AbortController();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => ms === 20_000 ? deadline.signal : timeout(ms));
    const entered = deferred<void>();
    f.fetchImpl.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new TypeError("PRIVATE_TEST cancelled catalog network")), { once: true });
      entered.resolve();
    }));
    const pending = f.gpt.connect("pi", MODEL);
    await entered.promise;
    deadline.abort(new DOMException("PRIVATE_TEST deadline", "TimeoutError"));
    expect(await pending).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
    expect(JSON.stringify(f.gpt.status())).not.toContain("PRIVATE_TEST");
  });

  it("catalog size-policy rejection is not retried as a transient network failure", async () => {
    const f = await fixture();
    const cancelled = vi.fn();
    f.fetchImpl.mockImplementationOnce(async () => new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-length": String(CATALOG_LIMIT_BYTES + 1) } }));
    expect(await f.gpt.connect("pi", MODEL)).toBe(false);
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_MODELS]);
    expect(cancelled).toHaveBeenCalled();
  });

  it.each([502, 503, 504, "network"] as const)("inference %s failure never automatically repeats the POST", async failure => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    f.fetchImpl.mockClear();
    f.respond(() => {
      if (failure === "network") throw new TypeError("PRIVATE_TEST inference network");
      return new Response("PRIVATE_TEST inference rejection", { status: failure });
    });
    const result = await f.gpt.generate([{ role: "user", content: "TEST inference" }]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TEST");
    expect(f.fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([GPT_RESPONSES]);
    await f.gpt.disconnect();
  });
});

const searchOutput = (overrides: Record<string, unknown> = {}) => [
  { type: "web_search_call", id: "TEST-search", status: "completed", action: { type: "search", query: "TEST", sources: [{ url: "https://example.org/test", title: "TEST secondary" }] }, ...overrides },
  { type: "message", content: [{ type: "output_text", text: "TEST factual answer [source](https://example.com/test).", annotations: [
    { type: "url_citation", url: "https://example.com/test?utm_source=openai", title: "TEST primary", start_index: 0, end_index: 20 },
    { type: "url_citation", url: "https://example.com/test", title: "TEST duplicate" },
    { type: "url_citation", url: "https://127.0.0.1/private", title: "TEST unsafe" },
  ] }] },
];
const searchSse = (output: unknown[], status = "completed") => eventResponse([{ type: "response.completed", response: { id: "TEST-search-response", status, output } }]);
const doneSearchOutput = () => {
  const sources = Array.from({ length: 12 }, (_, index) => ({ title: `TEST source ${index}`, url: `https://example.com/TEST-source-${index}` }));
  return [
    { type: "web_search_call", id: "TEST-done-search", status: "completed", action: { type: "search", query: "TEST done frames", sources } },
    { type: "message", id: "TEST-done-message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "TEST 完整回答 with source seven.", annotations: [{ type: "url_citation", title: "TEST cited source seven", url: sources[7]!.url, start_index: 0, end_index: 12 }] }] },
  ];
};
const doneFrames = (items: Record<string, unknown>[]) => items.map((item, output_index) => frame({ type: "response.output_item.done", output_index, item })).join("");

describe("GPT search: real migrated citations and fixed provider transport", () => {
  it("recovers twelve sources and the complete cited message from done frames when terminal output is empty", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const items = doneSearchOutput();
    const upstream = responseWithoutType(doneFrames(items) + frame({ type: "response.completed", response: { id: "TEST-empty-terminal", status: "completed", error: null, output: [] } }));
    expect(upstream.headers.has("content-type")).toBe(false);
    const fetchImpl = vi.fn<typeof fetch>(async () => upstream);
    const results = await searchGpt(f.gpt, "TEST done frames", undefined, fetchImpl);
    // The real twelve-source tool output is preserved before the adapter's
    // existing five-result limit; cited message source comes first, deduped.
    expect(results.map(row => row.url)).toEqual([7, 0, 1, 2, 3].map(index => `https://example.com/TEST-source-${index}`));
    expect(results[0]).toMatchObject({ title: "TEST cited source seven", snippet: expect.stringContaining("TEST 完整回答"), readFullPage: false, provider: "pi-web-access/gpt-oauth" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await f.gpt.disconnect();
  });

  it("transport retains full done items but uses a nonempty terminal output without merging older items", async () => {
    const items = doneSearchOutput();
    for (const output of [[], searchOutput()]) {
      const terminal = { id: "TEST-terminal-priority", status: "completed", error: null, output };
      const result = await completedResponse(responseWithoutType(doneFrames(items) + frame({ type: "response.completed", response: terminal })), new AbortController().signal);
      expect(result).toEqual({ ...terminal, output: output.length ? output : items });
    }
  });

  it.each([
    { label: "EOF without completed", tail: "" },
    { label: "DONE sentinel without completed", tail: "data: [DONE]\n\n" },
    { label: "failed terminal", tail: frame({ type: "response.failed", response: { status: "failed", error: { message: "PRIVATE_TEST" }, output: [] } }) },
    { label: "incomplete terminal", tail: frame({ type: "response.incomplete", response: { status: "incomplete", output: [] } }) },
    { label: "error event", tail: frame({ type: "error", message: "PRIVATE_TEST" }) },
    { label: "completed type with failed status", tail: frame({ type: "response.completed", response: { status: "failed", output: [] } }) },
    { label: "completed type with error", tail: frame({ type: "response.completed", response: { status: "completed", error: { message: "PRIVATE_TEST" }, output: [] } }) },
    { label: "truncated completed frame", tail: 'event: response.completed\ndata: {"type":"response.completed","response":' },
  ])("full done items followed by $label still cannot produce successful evidence", async ({ tail }) => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => responseWithoutType(doneFrames(doneSearchOutput()) + tail))).rejects.toMatchObject({ code: "search-unavailable", message: expect.not.stringContaining("PRIVATE_TEST") });
    await f.gpt.disconnect();
  });

  it("added items and text deltas are never substituted for completed output_item.done payloads", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const partial = doneSearchOutput().map((item, output_index) => frame({ type: "response.output_item.added", output_index, item: { ...item, status: "in_progress" } })).join("");
    const wire = partial + frame({ type: "response.output_text.delta", delta: "TEST half answer" }) + frame({ type: "response.completed", response: { status: "completed", error: null, output: [] } });
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => responseWithoutType(wire))).rejects.toMatchObject({ code: "search-unavailable" });
    await f.gpt.disconnect();
  });

  it("search POST HTTP 503 is never retried through the catalog GET policy", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("PRIVATE_TEST search rejection", { status: 503 }));
    await expect(searchGpt(f.gpt, "TEST", undefined, fetchImpl)).rejects.toMatchObject({ code: "search-unavailable" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await f.gpt.disconnect();
  });

  it("accepts real headerless HTTP 200 SSE only after completed response, completed search call and citations", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const upstream = responseWithoutType([
      frame({ type: "response.created", response: { id: "TEST-headerless", status: "in_progress" } }),
      frame({ type: "response.output_text.delta", delta: "TEST partial 中文" }),
      frame({ type: "response.completed", response: { id: "TEST-headerless", status: "completed", error: null, output: searchOutput() } }),
    ].join(""));
    expect(upstream.status).toBe(200);
    expect(upstream.headers.has("content-type")).toBe(false);
    const fetchImpl = vi.fn<typeof fetch>(async () => upstream);
    const results = await searchGpt(f.gpt, "TEST headerless search", undefined, fetchImpl);
    expect(results.map(row => ({ title: row.title, url: row.url, provider: row.provider, readFullPage: row.readFullPage }))).toEqual([
      { title: "TEST primary", url: "https://example.com/test", provider: "pi-web-access/gpt-oauth", readFullPage: false },
      { title: "TEST secondary", url: "https://example.org/test", provider: "pi-web-access/gpt-oauth", readFullPage: false },
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toBe(GPT_RESPONSES);
    await f.gpt.disconnect();
  });

  it.each([
    { label: "HTML body", wire: "<html>PRIVATE_TEST no SSE</html>" },
    { label: "JSON body", wire: JSON.stringify({ status: "completed", output: searchOutput() }) },
    { label: "partial text only", wire: frame({ type: "response.output_text.delta", delta: "TEST plausible answer" }) },
    { label: "DONE sentinel only", wire: "data: [DONE]\n\n" },
    { label: "failed response status", wire: frame({ type: "response.completed", response: { status: "failed", output: searchOutput() } }) },
    { label: "completed frame with error", wire: frame({ type: "response.completed", response: { status: "completed", error: { message: "PRIVATE_TEST" }, output: searchOutput() } }) },
    { label: "unfinished tool call", wire: frame({ type: "response.completed", response: { status: "completed", output: searchOutput({ status: "in_progress" }) } }) },
    { label: "citations without search call", wire: frame({ type: "response.completed", response: { status: "completed", output: searchOutput().slice(1) } }) },
  ])("headerless HTTP 200 with $label cannot fabricate successful evidence", async ({ wire }) => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const upstream = responseWithoutType(wire);
    expect(upstream.headers.has("content-type")).toBe(false);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => upstream)).rejects.toMatchObject({ code: "search-unavailable", message: expect.not.stringContaining("PRIVATE_TEST") });
    await f.gpt.disconnect();
  });

  it.each(["text/html", "application/json"])("explicit %s is rejected even when its body contains valid completed SSE", async contentType => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const upstream = responseWithoutType(frame({ type: "response.completed", response: { status: "completed", error: null, output: searchOutput() } }));
    upstream.headers.set("content-type", contentType);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => upstream)).rejects.toMatchObject({ code: "search-unavailable" });
    await f.gpt.disconnect();
  });

  it("legacy OAuth search sends the account claim and Pi headers only to the Codex endpoint", async () => {
    const access = `TEST.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "TEST-legacy-account" } })).toString("base64url")}.TEST`;
    const f = await fixture({ route: "openai-codex", access });
    expect(await f.gpt.connect("pi")).toBe(true);
    const fetchImpl = vi.fn<typeof fetch>(async () => searchSse(searchOutput()));
    expect(await searchGpt(f.gpt, "TEST legacy query", undefined, fetchImpl)).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(CODEX_RESPONSES);
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${access}`);
    expect(headers.get("chatgpt-account-id")).toBe("TEST-legacy-account");
    expect(headers.get("openai-beta")).toBe("responses=experimental");
    expect(headers.get("originator")).toBe("pi");
    expect(JSON.stringify(await f.gpt.status())).not.toContain("TEST-legacy-account");
    await f.gpt.disconnect();
  });

  it("bad legacy account claims fail closed without exposing raw claim/auth errors", async () => {
    const token = (account: string) => `TEST.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.TEST`;
    const f = await fixture({ route: "openai-codex", access: token("TEST-good-account") });
    expect(await f.gpt.connect("pi")).toBe(true);
    await f.piStorage.modify("openai-codex", async () => credential(token(`PRIVATE/account/${ACCESS}`)));
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(searchGpt(f.gpt, "TEST", undefined, fetchImpl)).rejects.toMatchObject({ code: "search-unavailable", message: "GPT 搜索不可用，请检查登录、模型搜索权限或额度。" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it("requires upstream web_search, extracts/deduplicates citations, and never fetches cited pages", async () => {
    const f = await fixture();
    expect(await f.gpt.connect("pi", MODEL)).toBe(true);
    const fetchImpl = vi.fn<typeof fetch>(async () => searchSse(searchOutput()));
    const results = await searchGpt(f.gpt, "TEST query", undefined, fetchImpl);
    expect(results).toEqual([
      { title: "TEST primary", url: "https://example.com/test", snippet: expect.stringContaining("TEST factual answer"), fetchedAt: expect.any(String), provider: "pi-web-access/gpt-oauth", readFullPage: false },
      { title: "TEST secondary", url: "https://example.org/test", snippet: "", fetchedAt: expect.any(String), provider: "pi-web-access/gpt-oauth", readFullPage: false },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(GPT_RESPONSES);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: MODEL, store: false, stream: true, tools: [{ type: "web_search" }], tool_choice: "required", include: ["web_search_call.action.sources"] });
    expect(body.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "TEST query" }] }]);
    expect(JSON.stringify(body)).not.toMatch(/"(?:bash|read|write|edit|shell|mcp)"/);
    expect(fetch).not.toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it("rejects plausible citations without any real web_search_call", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => searchSse(searchOutput().slice(1)))).rejects.toMatchObject({ code: "search-unavailable" });
    await f.gpt.disconnect();
  });

  it("does not accept an unfinished search call as completed evidence", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => searchSse(searchOutput({ status: "in_progress" })))).rejects.toMatchObject({ code: "search-unavailable" });
    await f.gpt.disconnect();
  });

  it("does not accept a response.completed frame carrying failed response status", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => searchSse(searchOutput(), "failed"))).rejects.toMatchObject({ code: "search-unavailable" });
    await f.gpt.disconnect();
  });

  it.each([
    { reason: new Error(ACCESS), code: "search-cancelled", status: 503, label: "caller cancellation" },
    { reason: new DOMException(ACCESS, "TimeoutError"), code: "search-timeout", status: 504, label: "deadline expiry" },
  ])("aborts pending search reads on $label without exposing the private reason", async ({ reason, code, status }) => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const parent = new AbortController();
    const entered = deferred<void>();
    const cancelled = vi.fn();
    const pending = searchGpt(f.gpt, "TEST", parent.signal, async () => new Response(new ReadableStream<Uint8Array>({ start() { entered.resolve(); }, cancel: cancelled }), { headers: { "content-type": "text/event-stream" } }));
    const rejected = expect(pending).rejects.toMatchObject({ code, status, message: expect.not.stringContaining(ACCESS) });
    await entered.promise;
    parent.abort(reason);
    await rejected;
    expect(cancelled).toHaveBeenCalled();
    await f.gpt.disconnect();
  });

  it("drops search citations returned after disconnect without signing Pi out", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const entered = deferred<void>(); const late = deferred<Response>();
    const pending = searchGpt(f.gpt, "TEST", undefined, async () => { entered.resolve(); return late.promise; });
    const rejected = expect(pending).rejects.toMatchObject({ code: "search-unavailable" });
    await entered.promise; await f.gpt.disconnect(); late.resolve(searchSse(searchOutput())); await rejected;
    expect(await f.piStorage.read("openai")).toEqual(credential());
  });

  it("a citation containing access-token material fails closed and does not return private text", async () => {
    const f = await fixture(); await f.gpt.connect("pi", MODEL);
    const output = [
      { type: "web_search_call", status: "completed" },
      { type: "message", content: [{ type: "output_text", text: ACCESS, annotations: [{ type: "url_citation", url: `https://example.com/${ACCESS}`, title: "TEST" }] }] },
    ];
    await expect(searchGpt(f.gpt, "TEST", undefined, async () => searchSse(output))).rejects.toMatchObject({ code: "search-unavailable", message: expect.not.stringContaining(ACCESS) });
    await f.gpt.disconnect();
  });
});

describe("GPT transport bounds, endpoints and terminal frames", () => {
  it.each(["https://evil.test/v1/responses", "https://api.openai.com/v1/responses?proxy=x", "https://api.openai.com/v1/chat/completions", "http://api.openai.com/v1/responses", "https://api.openai.com.evil.test/v1/responses", "http://127.0.0.1/", "file:///etc/passwd"])("rejects arbitrary endpoint %s before fetch", async url => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(gptFetch(fetchImpl)(url)).rejects.toThrow("Unsupported GPT endpoint");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("overrides redirect/cookie settings and forwards caller cancellation", async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ models: [] }));
    const response = await gptFetch(fetchImpl)(GPT_MODELS, { signal, redirect: "follow", credentials: "include" });
    expect(await response.json()).toEqual({ models: [] });
    expect(fetchImpl).toHaveBeenCalledWith(GPT_MODELS, expect.objectContaining({ signal, redirect: "error", credentials: "omit" }));
  });

  it.each(["redirected", "url"])("rejects a hidden redirect reported through %s and cancels its body", async property => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    Object.defineProperty(response, property, { value: property === "url" ? "https://evil.test/" : true });
    await expect(gptFetch(async () => response)(GPT_RESPONSES)).rejects.toThrow("redirect");
    expect(cancelled).toHaveBeenCalled();
  });

  it.each([
    { url: GPT_RESPONSES, limit: MAX_GPT_RESPONSE_BYTES, label: "OpenAI inference 512 KiB" },
    { url: CODEX_RESPONSES, limit: MAX_GPT_RESPONSE_BYTES, label: "Codex inference 512 KiB" },
    { url: GPT_MODELS, limit: CATALOG_LIMIT_BYTES, label: "catalog 4 MiB" },
  ])("rejects advertised oversized $label bodies before reading and cancels upstream", async ({ url, limit }) => {
    const cancelled = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-length": String(limit + 1) } });
    await expect(gptFetch(async () => upstream)(url)).rejects.toThrow("too large");
    expect(cancelled).toHaveBeenCalled();
  });

  it.each([
    { url: GPT_RESPONSES, limit: MAX_GPT_RESPONSE_BYTES, label: "OpenAI inference 512 KiB" },
    { url: CODEX_RESPONSES, limit: MAX_GPT_RESPONSE_BYTES, label: "Codex inference 512 KiB" },
    { url: GPT_MODELS, limit: CATALOG_LIMIT_BYTES, label: "catalog 4 MiB" },
  ])("bounds streamed $label bodies without Content-Length and does not leak stream errors", async ({ url, limit }) => {
    const bounded = await gptFetch(async () => new Response(new Uint8Array(limit)))(url);
    expect((await bounded.arrayBuffer()).byteLength).toBe(limit);
    const cancelled = vi.fn();
    const upstream = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(limit)); controller.enqueue(new Uint8Array(1)); }, cancel: cancelled }));
    const response = await gptFetch(async () => upstream)(url);
    await expect(response.arrayBuffer()).rejects.toThrow("GPT response unavailable");
    expect(cancelled).toHaveBeenCalled();
    const broken = new Response(new ReadableStream({ pull() { throw new Error(ACCESS); } }));
    await expect((await gptFetch(async () => broken)(url)).text()).rejects.toThrow("GPT response unavailable");
  });

  it("consumer cancellation reaches the original stream", async () => {
    const cancelled = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel: cancelled }));
    const response = await gptFetch(async () => upstream)(GPT_RESPONSES);
    await response.body!.cancel();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("parses fragmented UTF-8 and CRLF SSE without treating DONE or partial output as completion", async () => {
    const response = { id: "TEST-response", status: "completed", output: [{ type: "message", text: "TEST 中文" }] };
    const bytes = new TextEncoder().encode(`: TEST heartbeat\r\n\r\ndata: [DONE]\r\n\r\n${frame({ type: "response.completed", response }).replace(/\n/g, "\r\n")}`);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } });
    expect(await completedResponse(new Response(stream, { headers: { "content-type": "text/event-stream" } }), new AbortController().signal)).toEqual(response);
    await expect(completedResponse(eventResponse([{ type: "response.output_text.delta", delta: '{"ok":true}' }]), new AbortController().signal)).rejects.toThrow("without completion");
  });

  it.each(["response.failed", "response.incomplete", "error"])("rejects terminal %s without returning private provider details", async type => {
    await expect(completedResponse(eventResponse([{ type, message: ACCESS, response: { error: { message: REFRESH } } }]), new AbortController().signal)).rejects.toThrow("GPT search did not complete");
  });

  it.each(["text/event-stream", undefined])("search SSE with Content-Type %s keeps its 512 KiB cap and rejects JSON/HTTP errors", async contentType => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_GPT_RESPONSE_BYTES + 1)); }, cancel: cancelled }), contentType ? { headers: { "content-type": contentType } } : {});
    await expect(completedResponse(response, new AbortController().signal)).rejects.toThrow("too large");
    expect(cancelled).toHaveBeenCalled();
    for (const body of [Response.json({ output: searchOutput() }), new Response(ACCESS, { status: 403, headers: { "content-type": "text/event-stream" } })]) {
      await expect(completedResponse(body, new AbortController().signal)).rejects.toThrow("GPT search unavailable");
    }
  });
});
