import { z } from "zod";
import { SearchError, publicSearchError } from "./errors.js";
import { publicHttpsUrl } from "./policy.js";
import { abortError, requestPublicHttps } from "./transport.js";
import { callExaMcp, parseMcpResults } from "./upstream/exa.js";
import type { CredentialStore } from "../credentials.js";
import { callStepSearch, STEPSEARCH_PROVIDER, untilAborted } from "./stepsearch.js";

export const SEARCH_TOOL_NAMES = Object.freeze(["web_search", "fetch_content"] as const);
export const SEARCH_PROVIDER = "pi-web-access/exa-mcp-keyless";

export interface SearchEvidence {
  title: string;
  url: string;
  snippet: string;
  fetchedAt: string;
  provider: typeof SEARCH_PROVIDER | typeof STEPSEARCH_PROVIDER | "pi-web-access/gpt-oauth";
  readFullPage: false;
}

export interface SearchConfig {
  timeoutMs: number;
  fetchTimeoutMs: number;
  maxResults: number;
  maxResponseBytes: number;
  maxTextChars: number;
  maxConcurrent: number;
  requestsPerMinute: number;
}

const ConfigSchema = z.strictObject({
  timeoutMs: z.number().int().min(1).max(30_000).default(20_000),
  fetchTimeoutMs: z.number().int().min(1).max(30_000).default(12_000),
  maxResults: z.number().int().min(1).max(10).default(5),
  maxResponseBytes: z.number().int().min(1).max(512 * 1024).default(256 * 1024),
  maxTextChars: z.number().int().min(1).max(30_000).default(20_000),
  maxConcurrent: z.number().int().min(1).max(4).default(2),
  requestsPerMinute: z.number().int().min(1).max(30).default(10),
});

export const QuerySchema = z.string().trim().min(1).max(500)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const JsonResultsSchema = z.object({ results: z.array(z.object({
  title: z.string().optional(), url: z.string(), text: z.string().optional(),
  highlights: z.array(z.string()).optional(),
})).max(100) });

const clean = (text: string, length: number) => text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/g, " ").trim().slice(0, length);

/** Normalization only; these are provider excerpts, never an assertion that pages were read. */
export function normalizeSearchResults(text: string, maxResults: number, fetchedAt: string): SearchEvidence[] {
  let json: unknown;
  try { json = JSON.parse(text); } catch { /* Upstream basic tool normally returns text blocks. */ }
  const structured = JsonResultsSchema.safeParse(json);
  const rows = structured.success
    ? structured.data.results.map(row => ({ ...row, content: row.highlights?.join(" ") || row.text || "" }))
    : parseMcpResults(text);
  if (!rows || (json !== undefined && !structured.success)) {
    throw new SearchError("search-invalid-response", "搜索源未返回有效的来源列表。", 502);
  }
  const seen = new Set<string>();
  const results: SearchEvidence[] = [];
  for (const row of rows) {
    let url: URL;
    try { url = publicHttpsUrl(row.url); } catch { continue; }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({
      title: clean(row.title || url.hostname, 300), url: url.href,
      snippet: clean(row.content, 700), fetchedAt,
      provider: SEARCH_PROVIDER, readFullPage: false,
    });
    if (results.length >= maxResults) break;
  }
  if (rows.length && !results.length) throw new SearchError("search-invalid-response", "搜索源未返回可引用的公开 HTTPS 来源。", 502);
  return results;
}

export interface FetchEvidence {
  url: string;
  text: string;
  contentType: string;
  format: "raw-text";
  fetchedAt: string;
  provider: "vivic-bounded-https";
  readFullPage: false;
  truncated: boolean;
  trust: "untrusted-web-data";
}

/** Only backend in-memory credentials; no Pi tools, host configuration or extensions. */
export function createSearchClient(options: {
  config?: Partial<SearchConfig>; credentials?: CredentialStore; fetchImpl?: typeof fetch;
  selectSearch?: () => ((query: string, signal: AbortSignal) => Promise<SearchEvidence[]>) | undefined;
  captureSession?: () => () => boolean;
} = {}) {
  const config = ConfigSchema.parse(options.config ?? {});
  let active = 0;
  let windowStarted = Date.now();
  let requests = 0;
  async function run<T>(timeout: number, parent: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (Date.now() - windowStarted >= 60_000) { windowStarted = Date.now(); requests = 0; }
    if (active >= config.maxConcurrent) throw new SearchError("search-busy", "联网查询繁忙，请稍后重试。", 429);
    if (requests >= config.requestsPerMinute) throw new SearchError("search-rate-limited", "联网查询过于频繁，请稍后重试。", 429);
    const deadline = AbortSignal.timeout(timeout);
    const signal = parent ? AbortSignal.any([deadline, parent]) : deadline;
    active++; requests++;
    try {
      if (signal.aborted) throw abortError(signal);
      const result = await untilAborted(work(signal), signal);
      if (signal.aborted) throw abortError(signal);
      return result;
    } catch (error) {
      throw signal.aborted ? abortError(signal) : publicSearchError(error);
    } finally { active--; }
  }
  return Object.freeze({
    async webSearch(query: string, parent?: AbortSignal): Promise<SearchEvidence[]> {
      const parsed = QuerySchema.safeParse(query);
      if (!parsed.success) throw new SearchError("search-invalid-input", "搜索词须为 1–500 字符的文本。", 400);
      const override = options.selectSearch?.();
      const sessionCurrent = options.captureSession?.();
      const credential = override ? undefined : options.credentials?.getSecret();
      const assertCurrent = () => {
        if ((sessionCurrent && !sessionCurrent()) || (!override && options.credentials?.getSecret() !== credential)) {
          throw new SearchError("search-cancelled", "联网查询已取消：模型连接已变更。", 503);
        }
      };
      try {
        return await run(config.timeoutMs, parent, async signal => {
          assertCurrent();
          if (override) return await override(parsed.data, signal);
          if (credential) return await callStepSearch({ apiKey: credential.apiKey, query: parsed.data,
            maxResults: config.maxResults, maxBytes: config.maxResponseBytes, signal,
            fetchImpl: options.fetchImpl, assertCurrent });
          const text = await callExaMcp(parsed.data, config.maxResults, signal, config.maxResponseBytes);
          return normalizeSearchResults(text, config.maxResults, new Date().toISOString());
        });
      } finally { assertCurrent(); }
    },
    async fetchContent(raw: string, parent?: AbortSignal): Promise<FetchEvidence> {
      const first = publicHttpsUrl(raw);
      return run(config.fetchTimeoutMs, parent, async signal => {
        let current = first;
        for (let hop = 0; hop <= 3; hop++) {
          const reply = await requestPublicHttps(current.href, {
            signal, maxBytes: config.maxResponseBytes,
            headers: { Accept: "text/plain, text/markdown, text/html, application/xhtml+xml" },
            acceptContentType: type => ["text/plain", "text/markdown", "text/html", "application/xhtml+xml"].includes(type),
          });
          if ([301, 302, 303, 307, 308].includes(reply.status)) {
            if (!reply.location || hop === 3) throw new SearchError("search-unavailable", "网页重定向无效或次数过多。", 502);
            try { current = publicHttpsUrl(new URL(reply.location, current).href); }
            catch { throw new SearchError("search-blocked-url", "网页重定向至不允许的地址。", 400); }
            continue;
          }
          if (reply.status < 200 || reply.status >= 300) throw new SearchError("search-unavailable", "当前网页不可读取。", 502);
          const text = reply.body.toString("utf8");
          return {
            url: current.href, text: text.slice(0, config.maxTextChars),
            contentType: reply.contentType, format: "raw-text", fetchedAt: new Date().toISOString(),
            provider: "vivic-bounded-https", readFullPage: false,
            truncated: text.length > config.maxTextChars, trust: "untrusted-web-data",
          };
        }
        throw new SearchError("search-unavailable", "当前网页不可读取。", 502);
      });
    },
  });
}

export type SearchClient = ReturnType<typeof createSearchClient>;
