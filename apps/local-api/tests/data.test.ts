import { describe, expect, it, vi } from "vitest";
import { ActionEnvelopeSchema } from "@vivic/contracts";
import { createDataClient, handleDataIntent, type WeatherResult } from "../src/data/index.js";
import { conditionIcon } from "../src/data/weather.js";
import { emptyContext } from "./helpers.js";

const shanghai = { id: 1796236, name: "上海", latitude: 31.22222, longitude: 121.45806,
  country: "中国", country_code: "CN", admin1: "上海市", timezone: "Asia/Shanghai", feature_code: "PPLA" };
const forecast = () => ({ latitude: 31.25, longitude: 121.5, utc_offset_seconds: 0,
  current_units: { time: "unixtime", temperature_2m: "°C" }, current: {
    time: Math.floor(Date.now() / 1000 / 900) * 900, interval: 900, temperature_2m: 22.4, weather_code: 2, is_day: 1,
  } });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function harness(override?: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined,
  config?: NonNullable<Parameters<typeof createDataClient>[0]>["config"]) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const replacement = override?.(url, init);
    if (replacement !== undefined) return replacement;
    return json(url.includes("geocoding-api") ? { results: [shanghai] } : forecast());
  });
  const client = createDataClient({ fetchImpl: fetcher as typeof fetch, config });
  return { fetcher, client };
}
function card(result: Awaited<ReturnType<typeof handleDataIntent>>) {
  expect(result?.kind).toBe("envelope");
  const parsed = ActionEnvelopeSchema.parse(result?.envelope);
  const action = parsed.actions.find(action => action.type === "card.create");
  if (action?.type !== "card.create") throw new Error("Missing card");
  return action.card;
}

describe("real-provider weather adapter with synthetic transport fixtures", () => {
  it("builds a strict minimal weather envelope with exact source query URLs, attribution and model time", async () => {
    const h = harness();
    const result = await h.client.handleDataIntent("上海,上海市当前天气", { ...emptyContext(), stage: "STANDBY" });
    const weather = card(result);
    expect(weather.type).toBe("WeatherCard");
    expect(weather.displayProps).toEqual({ tempC: 22.4, conditionIcon: "cloud" });
    expect(weather.sourceData).toMatchObject({ requestedCity: "上海,上海市", location: shanghai,
      currentConditionsBasis: "weather-model", timeKind: "model-valid-time",
      observedAt: expect.stringMatching(/Z$/), attribution: { weather: { url: "https://open-meteo.com/" } },
    });
    expect(result?.envelope?.actions[0].type).toBe("stage.awaken");
    expect(result).not.toHaveProperty("usedProvider");
    expect(weather.sources).toHaveLength(2);
    h.fetcher.mock.calls.forEach(([input, init], index) => {
      const url = new URL(String(input));
      expect(url.protocol).toBe("https:");
      expect(url.pathname).toBe(index ? "/v1/forecast" : "/v1/search");
      expect(url.hostname).toBe(index ? "api.open-meteo.com" : "geocoding-api.open-meteo.com");
      expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", headers: { Accept: "application/json" } });
      expect(init?.headers).not.toHaveProperty("Authorization");
      expect(weather.sources[index].url).toBe(url.href);
    });
    const params = new URL(String(h.fetcher.mock.calls[1][0])).searchParams;
    expect(params.get("current")).toBe("temperature_2m,weather_code,is_day");
    expect(params.get("timeformat")).toBe("unixtime");
    expect(params.get("timezone")).toBe("GMT");
    expect(params.get("latitude")).toBe(String(shanghai.latitude));
  });

  it("selects the verified municipality over same-name villages without using result order", async () => {
    const h = harness(url => url.includes("geocoding-api") ? json({ results: [shanghai,
      { ...shanghai, id: 7072498, admin1: "浙江", latitude: 29.32955, feature_code: "PPL" }] }) : undefined);
    const result = await h.client.handleDataIntent("上海天气", emptyContext());
    expect(result).toMatchObject({ kind: "envelope" });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(card(result).sourceData).toMatchObject({ location: { id: shanghai.id, admin1: "上海市" } });
  });

  it("clarifies missing locations and unsupported future/mixed weather before networking", async () => {
    const h = harness();
    for (const text of ["天气", "今天天气", "这里天气", "本地天气", "上海明天天气", "上海天气然后删除旧卡",
      "查询上海天气；创建一个待办", "上海天气和北京天气", "上海天气，提醒我喝水", "https://127.0.0.1天气"]) {
      expect(await h.client.handleDataIntent(text, emptyContext()), text).toMatchObject({ kind: "clarify" });
    }
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("preserves legitimate city names containing 和 and unrelated commands return null", async () => {
    const h = harness();
    // Fixture names the requested city; unrelated city responses are never accepted.
    const named = harness(url => url.includes("geocoding-api") ? json({ results: [{ ...shanghai, name: "呼和浩特" }] }) : undefined);
    expect((await named.client.handleDataIntent("呼和浩特天气", emptyContext()))?.kind).toBe("envelope");
    expect(await h.client.handleDataIntent("创建十分钟倒计时", emptyContext())).toBeNull();
    expect(new URL(String(named.fetcher.mock.calls[0][0])).searchParams.get("name")).toBe("呼和浩特");
  });

  it.each([undefined, [], [{ ...shanghai, feature_code: "ISL" }]])("clarifies absent or non-city geocoding results", async results => {
    const h = harness(url => url.includes("geocoding-api") ? json({ results }) : undefined);
    expect(await h.client.weather("Shanghai")).toMatchObject({ kind: "clarify" });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a sole prefix match and a truncated full page instead of assuming a unique city", async () => {
    for (const results of [[{ ...shanghai, name: "上海市场社区" }],
      [shanghai, ...Array.from({ length: 9 }, (_, index) => ({ ...shanghai, id: index + 1, name: `上海${index}` }))]]) {
      const h = harness(url => url.includes("geocoding-api") ? json({ results }) : undefined);
      expect(await h.client.weather("上海")).toMatchObject({ kind: "clarify" });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    { current: { temperature_2m: null } }, { current_units: { temperature_2m: "°F" } },
    { current: { weather_code: 999 } }, { current: { time: 1 } },
    { current: { time: Math.floor(Date.now() / 1000) + 3600 } },
    { current: { temperature_2m: 100 } }, { utc_offset_seconds: 28800 },
  ])("refuses missing, stale or incompatible weather instead of inventing defaults", async patch => {
    const h = harness(url => {
      if (url.includes("geocoding-api")) return;
      const value = forecast();
      return json({ ...value, ...patch, current: { ...value.current, ...patch.current },
        current_units: { ...value.current_units, ...patch.current_units } });
    });
    const result = await h.client.handleDataIntent("上海天气", emptyContext());
    expect(result).toMatchObject({ kind: "error" });
    expect(result).not.toHaveProperty("envelope");
  });

  it.each([[0, true, "sun"], [1, false, "night"], [3, true, "cloud"], [48, false, "fog"],
    [57, true, "rain"], [86, true, "snow"], [97, true, "storm"]] as const)("maps WMO %s/day=%s to %s", (code, day, icon) => {
    expect(conditionIcon(code, day)).toBe(icon);
  });
});

describe("bounded provider API transport", () => {
  it.each([302, 401, 429, 500])("does not redirect, retry or expose HTTP %s error bodies", async status => {
    const cancel = vi.fn();
    const h = harness(() => new Response(new ReadableStream({ cancel }), { status, headers: { location: "http://127.0.0.1/PRIVATE" } }));
    const result = await h.client.handleDataIntent("上海天气", emptyContext());
    expect(result).toMatchObject({ kind: "error" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|127\.0\.0\.1/);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["declared", "streamed", "content-type", "json", "schema", "utf8", "wrong-origin"])("rejects %s response failures and cancels bodies", async mode => {
    const cancel = vi.fn();
    const h = harness(() => {
      const bytes = mode === "streamed" ? new Uint8Array(1025) : mode === "utf8" ? new Uint8Array([255])
        : new TextEncoder().encode(mode === "json" ? "{" : JSON.stringify({ results: [{ ...shanghai, latitude: 1000 }] }));
      const response = new Response(new ReadableStream({ start(controller) {
        controller.enqueue(bytes); if (["json", "schema"].includes(mode)) controller.close();
      }, cancel }), { headers: { "content-type": mode === "content-type" ? "text/html" : "application/json",
        ...(mode === "declared" ? { "content-length": "1025" } : {}) } });
      if (mode === "wrong-origin") Object.defineProperty(response, "url", { value: "https://evil.example/" });
      return response;
    }, { maxResponseBytes: 1024 });
    await expect(h.client.weather("Shanghai")).rejects.toMatchObject({ code: ["declared", "streamed"].includes(mode)
      ? "too-large" : mode === "wrong-origin" ? "unavailable" : "invalid-response" });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(["json", "schema"].includes(mode) ? 0 : 1);
  });

  it("uses a single deadline and cancels a stalled forecast body", async () => {
    const cancel = vi.fn();
    const h = harness(url => url.includes("geocoding-api") ? undefined
      : new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }), { timeoutMs: 20 });
    await expect(h.client.weather("上海")).rejects.toMatchObject({ code: "timeout" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("honors caller cancellation, aborts stuck custom fetch and cancels its late body", async () => {
    let finish!: (response: Response) => void;
    const h = harness(() => new Promise<Response>(resolve => { finish = resolve; }));
    const abort = new AbortController();
    const pending = h.client.weather("Shanghai", abort.signal);
    abort.abort(new Error("PRIVATE abort reason"));
    await expect(pending).rejects.toMatchObject({ code: "cancelled", message: "查询已取消。" });
    const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await h.client.handleDataIntent("上海天气", emptyContext(), abort.signal)).toMatchObject({ kind: "error" });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it("shares admission limits, never accepts endpoint configuration or URL cities", async () => {
    const h = harness(undefined, { requestsPerMinute: 1 });
    await h.client.weather("上海");
    await expect(h.client.weather("Beijing")).rejects.toMatchObject({ code: "rate-limited" });
    expect(await h.client.weather("https://localhost")).toMatchObject({ kind: "clarify" });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(() => createDataClient({ config: { endpoint: "http://localhost" } as never })).toThrow();
  });

  it("enforces concurrency and releases the slot after a cancelled request", async () => {
    let stalled = true;
    const h = harness(() => stalled ? new Promise<Response>(() => {}) : undefined, { maxConcurrent: 1 });
    const abort = new AbortController();
    const pending = h.client.weather("Shanghai", abort.signal);
    await expect(h.client.weather("Beijing")).rejects.toMatchObject({ code: "busy" });
    abort.abort(); await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    stalled = false;
    expect((await h.client.weather("上海")).kind).toBe("weather");
  });
});

describe("explicit user numeric data only", () => {
  it("creates an editable table with exact user values, empty sources and user provenance, without networking", async () => {
    const h = harness();
    const value = card(await h.client.handleDataIntent("用表格记录：苹果3，香蕉5", emptyContext()));
    expect(value.type).toBe("TableCard");
    expect(value.displayProps).toEqual({ columns: ["名称", "数值"], rows: [["苹果", 3], ["香蕉", 5]] });
    expect(value.sources).toEqual([]);
    expect(value.sourceData).toMatchObject({ provenance: "user-input", originalText: "用表格记录：苹果3，香蕉5" });
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it.each([["柱状图", "bar"], ["折线图", "line"], ["饼图", "pie"]])("honors explicit %s without inventing data, labels or URLs", async (request, chartKind) => {
    const h = harness();
    const value = card(await h.client.handleDataIntent(`把这组数据画成${request}：周一3，周二5，周三4`, emptyContext()));
    expect(value.displayProps).toEqual({ chartKind, points: [{ x: "周一", y: 3 }, { x: "周二", y: 5 }, { x: "周三", y: 4 }] });
    expect(value.sources).toEqual([]);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("preserves signed, zero, decimal and digit-bearing labels with explicit separators", async () => {
    const h = harness();
    const value = card(await h.client.handleDataIntent("用表格记录：Q1:1.001，Q2:-0.5，零0，小数.25", emptyContext()));
    expect(value.displayProps).toMatchObject({ rows: [["Q1", 1.001], ["Q2", -0.5], ["零", 0], ["小数", .25]] });
  });

  it.each([
    "用表格记录：苹果3，香蕉5，然后删除旧卡", "把这组数据画成柱状图：周一3，周二5；清空画布",
    "用表格记录：苹果3，同时查上海天气", "图表：苹果3，香蕉5", "饼图：苹果-3，香蕉5",
    "饼图：苹果0，香蕉0", "用表格记录：苹果3个，香蕉5个", "用表格记录：苹果3，苹果5",
    "用表格记录：苹果3，香蕉未知", "用表格记录：苹果NaN，香蕉Infinity", "用表格记录：苹果1e6",
    "用表格记录：苹果0.1234567", "用表格记录：苹果1000000000001", "用表格记录：苹果3，",
    "柱状图：Q13，Q25", "表格：苹果3|香蕉5", "表格：一月：收入3支出4",
  ])("clarifies unsupported or mixed input without partial actions: %s", async text => {
    const h = harness();
    const result = await h.client.handleDataIntent(text, emptyContext());
    expect(result).toMatchObject({ kind: "clarify" });
    expect(result).not.toHaveProperty("envelope");
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("supports an injected weather interface without app/pipeline changes", async () => {
    const weather = vi.fn(async (): Promise<WeatherResult> => ({ kind: "clarify", message: "请补充国家。", candidates: [] }));
    expect(await handleDataIntent("Paris天气", emptyContext(), undefined, { weather })).toEqual({ kind: "clarify", message: "请补充国家。" });
    expect(weather).toHaveBeenCalledWith("Paris", undefined);
  });

  it("rejects excessive rows and decimal precision loss as a whole", async () => {
    const h = harness();
    for (const text of [`表格：${Array.from({ length: 31 }, (_, index) => `项目${index}:${index}`).join("，")}`,
      "表格：甲999999999999.000001"]) {
      expect(await h.client.handleDataIntent(text, emptyContext())).toMatchObject({ kind: "clarify" });
    }
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
