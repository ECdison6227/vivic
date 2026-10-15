import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionEnvelopeSchema, type CardRecord } from "@vivic/contracts";
import type { CanvasContext } from "../schemas.js";
import type { IntentResult } from "../intent/pipeline.js";
import { aborted, bounded, DataError } from "./transport.js";
import { CitySchema, lookupWeather, type WeatherResult } from "./weather.js";
import { parseNumericIntent } from "./numeric.js";
import { parseWeatherInput } from "./weatherInput.js";
import { transformDataIntent } from "./transform.js";
import { encodeProvenance, PROVENANCE_FIELD } from "./provenance.js";

export { DataError } from "./transport.js";
export type { WeatherEvidence, WeatherResult, WeatherLocation } from "./weather.js";
const Config = z.strictObject({
  timeoutMs: z.number().int().min(1).max(30_000).default(12_000),
  maxResponseBytes: z.number().int().min(1).max(256 * 1024).default(128 * 1024),
  maxConcurrent: z.number().int().min(1).max(4).default(2),
  requestsPerMinute: z.number().int().min(1).max(30).default(10),
});
export type DataConfig = z.infer<typeof Config>;
export interface DataClient {
  weather(city: string, signal?: AbortSignal): Promise<WeatherResult>;
  handleDataIntent(text: string, ctx: CanvasContext, signal?: AbortSignal): Promise<IntentResult | null>;
}

function envelope(ctx: CanvasContext, card: CardRecord, spokenText?: string): IntentResult {
  return { kind: "envelope", envelope: ActionEnvelopeSchema.parse({ schemaVersion: "0.6", requestId: `data_${randomUUID()}`,
    canvasId: ctx.canvasId, spokenText, actions: [...(ctx.stage === "STANDBY" ? [{ type: "stage.awaken" }] : []),
      { type: "card.create", card }, { type: "canvas.fit" }] }) };
}

/** Shared admission/deadline for both geocoding and forecast. No credentials or LLM. */
export function createDataClient(options: { fetchImpl?: typeof fetch; config?: Partial<DataConfig> } = {}): DataClient {
  const config = Config.parse(options.config ?? {});
  let active = 0;
  let started = Date.now();
  let requests = 0;
  const client: DataClient = {
    async weather(city, parent) {
      // Invalid cities and missing locations never consume network/admission slots.
      if (!CitySchema.safeParse(city).success) return { kind: "clarify", message: "请明确城市名；可补充省州或国家。", candidates: [] };
      if (parent?.aborted) throw aborted(parent);
      if (Date.now() - started >= 60_000) { requests = 0; started = Date.now(); }
      if (active >= config.maxConcurrent) throw new DataError("busy");
      if (requests >= config.requestsPerMinute) throw new DataError("rate-limited");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException("", "TimeoutError")), config.timeoutMs);
      const signal = parent ? AbortSignal.any([controller.signal, parent]) : controller.signal;
      active++; requests++;
      try {
        const result = await bounded(lookupWeather(city, { signal, maxBytes: config.maxResponseBytes, fetchImpl: options.fetchImpl ?? fetch }), signal);
        if (signal.aborted) throw aborted(signal);
        return result;
      } finally { active--; clearTimeout(timer); }
    },
    handleDataIntent: (text, ctx, signal) => handleDataIntent(text, ctx, signal, client),
  };
  return Object.freeze(client);
}

let shared: DataClient | undefined;
/** Returns null for unrelated intents; recognized but unsafe/unsupported requests clarify. */
export async function handleDataIntent(text: string, ctx: CanvasContext, signal?: AbortSignal, client?: Pick<DataClient, "weather">): Promise<IntentResult | null> {
  if (signal?.aborted) return { kind: "error", message: "查询已取消，未执行任何动作。" };
  if (!/天气|气温|表格|柱状图|条形图|折线图|饼图|图表/.test(text)) {
    const draft = ctx.cards.filter(card => card.type === "TableCard" && Array.isArray(card.displayProps.rows) && card.displayProps.rows.length === 0);
    const focused = draft.find(card => card.id === ctx.focusHistory.at(-1));
    const target = focused ?? (draft.length === 1 ? draft[0] : undefined);
    const numeric = target ? parseNumericIntent(`表格：${text}`) : null;
    if (!target || numeric?.kind !== "table" || !numeric.rows.length) return null;
    const stamp = new Date().toISOString(), original = { provenance: "user-input", originalText: text, capturedAt: stamp, rows: numeric.rows };
    return { kind: "envelope", usedProvider: "rules", envelope: ActionEnvelopeSchema.parse({ schemaVersion: "0.6", requestId: `data_${randomUUID()}`, canvasId: ctx.canvasId,
      spokenText: "已填入表格", actions: [{ type: "card.update", targetId: target.id,
        displayProps: { columns: ["名称", "数值"], rows: numeric.rows.map(row => [row.label, row.value]) },
        sourceData: { ...original, [PROVENANCE_FIELD]: encodeProvenance({ sources: [], sourceData: original })! } }] }) };
  }
  if (text.length > 500 || /[\p{Cc}\p{Cf}]/u.test(text.replace(/\n/g, ""))) return { kind: "clarify", message: "请提供不超过 500 字符的单项天气或数值指令。" };
  const transformed = transformDataIntent(text, ctx);
  if (transformed?.kind === "clarify") return transformed;
  if (transformed) return { kind: "envelope", usedProvider: "rules", envelope: ActionEnvelopeSchema.parse({
    schemaVersion: "0.6", requestId: `data_${randomUUID()}`, canvasId: ctx.canvasId,
    actions: [...(ctx.stage === "STANDBY" ? [{ type: "stage.awaken" }] : []), ...transformed.actions, { type: "canvas.fit" }],
  }) };
  const numeric = parseNumericIntent(text.trim());
  if (numeric?.kind === "clarify") return numeric;
  const stamp = new Date().toISOString();
  const common = { id: `data_${randomUUID()}`, variant: "minimal" as const, sources: [],
    layout: { x: 0, y: ctx.cards.length * 32, width: 320, height: 240, pinned: false },
    metadata: { createdAt: stamp, updatedAt: stamp } };
  if (numeric) {
    const original = { provenance: "user-input", originalText: text, capturedAt: stamp, rows: numeric.rows };
    const sourceData = { ...original, [PROVENANCE_FIELD]: encodeProvenance({ sources: [], sourceData: original })! };
    const card: CardRecord = numeric.kind === "table"
      ? { ...common, type: "TableCard", displayProps: { columns: ["名称", "数值"], rows: numeric.rows.map(row => [row.label, row.value]) }, sourceData }
      : { ...common, type: "ChartCard", displayProps: { chartKind: numeric.kind, points: numeric.rows.map(row => ({ x: row.label, y: row.value })) }, sourceData };
    return { ...envelope(ctx, card, numeric.kind === "table" ? numeric.rows.length ? "已创建表格" : "已创建空表格" : "已创建图表"), usedProvider: "rules" };
  }
  const request = parseWeatherInput(text);
  if (!request || request.kind === "clarify") return request;
  const { city } = request;
  try {
    const weather = await (client ?? (shared ??= createDataClient())).weather(city, signal);
    if (signal?.aborted) throw aborted(signal);
    if (weather.kind === "clarify") {
      const suggestions = [...new Set(weather.candidates.map(location => `${location.name},${location.admin1 ?? location.country}天气`))]
        .filter(value => value.length <= 100).slice(0, 5);
      return { kind: "clarify", message: weather.message, ...(suggestions.length ? { suggestions } : {}) };
    }
    return envelope(ctx, { ...common, type: "WeatherCard", displayProps: { tempC: weather.tempC, conditionIcon: weather.conditionIcon },
      sources: weather.sources, metadata: { ...common.metadata, aliases: [weather.location.name.slice(0, 80)] },
      sourceData: { provenance: "open-meteo", requestedCity: city, location: weather.location,
        observedAt: weather.observedAt, fetchedAt: weather.fetchedAt, currentConditionsBasis: "weather-model",
        timeKind: "model-valid-time", weatherCode: weather.weatherCode, isDay: weather.isDay,
        intervalSeconds: weather.intervalSeconds, modelGrid: weather.modelGrid,
        attribution: { weather: { name: "Open-Meteo", url: "https://open-meteo.com/" },
          geocoding: { name: "GeoNames", url: "https://www.geonames.org/" }, license: "https://creativecommons.org/licenses/by/4.0/",
          changes: "Selected current fields; WMO code mapped to card icon." } } }, `已显示${weather.location.name}当前天气`);
  } catch (error) {
    const safe = error instanceof DataError ? error : new DataError("unavailable");
    return { kind: "error", message: safe.message };
  }
}
