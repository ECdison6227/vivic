import { z } from "zod";
import type { EvidenceRef } from "@vivic/contracts";
import { DataError, FORECAST_ENDPOINT, GEOCODING_ENDPOINT, readProviderJson } from "./transport.js";

const safeName = z.string().trim().min(1).max(100).refine(value => !/[\p{Cc}\p{Cf}<>]/u.test(value));
const LocationSchema = z.object({
  id: z.number().int().positive(), name: safeName, latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180), country: safeName, country_code: z.string().regex(/^[A-Z]{2}$/),
  admin1: safeName.optional(), admin2: safeName.optional(), timezone: z.string().min(1).max(100),
  feature_code: z.string().min(1).max(10),
});
const GeocodingSchema = z.object({ results: z.array(LocationSchema).max(10).optional(), error: z.literal(false).optional() });
const ForecastSchema = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  utc_offset_seconds: z.literal(0),
  current_units: z.object({ time: z.literal("unixtime"), temperature_2m: z.literal("°C") }),
  current: z.object({ time: z.number().int().positive().max(10_000_000_000), interval: z.number().int().min(1).max(3600),
    temperature_2m: z.number().min(-100).max(65), weather_code: z.number().int(), is_day: z.union([z.literal(0), z.literal(1)]) }),
});
export type WeatherLocation = z.infer<typeof LocationSchema>;
export type ConditionIcon = "sun" | "cloud" | "rain" | "snow" | "fog" | "storm" | "night";
export interface WeatherEvidence {
  kind: "weather"; tempC: number; conditionIcon: ConditionIcon; location: WeatherLocation;
  observedAt: string; fetchedAt: string; weatherCode: number; isDay: boolean; intervalSeconds: number;
  modelGrid: { latitude: number; longitude: number }; sources: EvidenceRef[];
}
export type WeatherResult = WeatherEvidence | { kind: "clarify"; message: string; candidates: WeatherLocation[] };

export const CitySchema = z.string().trim().min(2).max(100)
  .refine(value => /^[\p{L}\p{M}\p{N} .,'’\-，]+$/u.test(value) && value.split(/[,，]/).length <= 2);

/** WMO codes from the official forecast docs; unknown codes never default to sun. */
export function conditionIcon(code: number, isDay: boolean): ConditionIcon {
  if (code === 0 || code === 1) return isDay ? "sun" : "night";
  if ([2, 3].includes(code)) return "cloud";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 97, 99].includes(code)) return "storm";
  throw new DataError("invalid-response");
}

export async function lookupWeather(city: string, options: {
  signal: AbortSignal; maxBytes: number; fetchImpl: typeof fetch;
}): Promise<WeatherResult> {
  const parsed = CitySchema.safeParse(city);
  if (!parsed.success) return { kind: "clarify", message: "请明确一个城市；同名地点可写成「上海,上海市天气」。", candidates: [] };
  const [rawName, qualifier] = parsed.data.replace(/，/g, ",").split(",");
  const name = rawName!.trim().replace(/市$/, "");
  const query = qualifier === undefined ? name : `${name},${qualifier.trim()}`;
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/市$/, "").trim();
  const geoUrl = new URL(GEOCODING_ENDPOINT);
  geoUrl.search = new URLSearchParams({ name: query, count: "10", language: /\p{Script=Han}/u.test(query) ? "zh" : "en", format: "json" }).toString();
  const geo = await readProviderJson(geoUrl, GeocodingSchema, options);
  const geoFetchedAt = new Date().toISOString();
  // Match verified place identity; never choose simply by ordering/population or GPS.
  let candidates = [...new Map((geo.results ?? []).filter(row => normalize(row.name) === normalize(name)
    && /^(?:PPL[A-Z0-9]*|ADM[1-4])$/.test(row.feature_code))
    .map(row => [row.id, row] as const)).values()];
  if (qualifier) candidates = candidates.filter(row => [row.admin1, row.admin2, row.country, row.country_code]
    .some(value => value && normalize(value) === normalize(qualifier)));
  // A municipality named explicitly by the user is a city, not every village
  // sharing its name. Keep using provider-verified coordinates and attribution.
  if (!qualifier && ["上海", "北京", "天津", "重庆"].includes(name)) {
    const municipality = candidates.filter(row => row.country_code === "CN" && row.admin1
      && normalize(row.admin1) === normalize(name) && /^(?:PPLC|PPLA|ADM1)$/.test(row.feature_code));
    if (municipality.length === 1) candidates = municipality;
  }
  if (candidates.length !== 1) {
    const labels = candidates.slice(0, 3).map(row => [...new Set([row.name, row.admin1, row.country].filter(Boolean))].join(" / "));
    return { kind: "clarify", candidates, message: candidates.length
      ? `找到多个同名或近似地点：${labels.join("；")}。请补充省州或国家，如「城市,省州天气」。`.slice(0, 400)
      : "没有找到明确的城市，请补充城市名、省州或国家。" };
  }
  // A full result page can hide further matches; require a narrower search.
  if (geo.results?.length === 10) return { kind: "clarify", candidates, message: "地点匹配过多，请补充省州或国家。" };
  const location = candidates[0]!;
  const forecastUrl = new URL(FORECAST_ENDPOINT);
  forecastUrl.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude),
    current: "temperature_2m,weather_code,is_day", temperature_unit: "celsius", timezone: "GMT",
    timeformat: "unixtime", forecast_days: "1" }).toString();
  const forecast = await readProviderJson(forecastUrl, ForecastSchema, options);
  const fetchedAt = new Date().toISOString();
  const observedAt = new Date(forecast.current.time * 1000).toISOString();
  const age = Date.now() - forecast.current.time * 1000;
  if (age > 3 * 3600_000 || age < -15 * 60_000) throw new DataError("invalid-response");
  return { kind: "weather", location, tempC: forecast.current.temperature_2m,
    conditionIcon: conditionIcon(forecast.current.weather_code, forecast.current.is_day === 1), observedAt, fetchedAt,
    weatherCode: forecast.current.weather_code, isDay: forecast.current.is_day === 1, intervalSeconds: forecast.current.interval,
    modelGrid: { latitude: forecast.latitude, longitude: forecast.longitude }, sources: [
      { title: "Open-Meteo geocoding · GeoNames", url: geoUrl.href, fetchedAt: geoFetchedAt, provider: "open-meteo/geocoding", readFullPage: false },
      { title: "Open-Meteo current weather (model data)", url: forecastUrl.href, fetchedAt, provider: "open-meteo/forecast", readFullPage: false },
    ] };
}
