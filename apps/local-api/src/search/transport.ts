import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { SearchError } from "./errors.js";
import { blockedUrl, isPublicAddress, publicHttpsUrl } from "./policy.js";

export interface HttpsReply {
  status: number;
  contentType: string;
  location?: string;
  body: Buffer;
}

export function abortError(signal: AbortSignal): SearchError {
  return signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
    ? new SearchError("search-timeout", "联网查询超时，请稍后重试。", 504)
    : new SearchError("search-cancelled", "联网查询已取消。", 503);
}

/** DNS lookups cannot be cancelled by Node; detach them on abort, with no socket opened. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** One hop only. Connects to the validated address, preserving TLS/SNI for the original host. */
export async function requestPublicHttps(raw: string, options: {
  signal: AbortSignal;
  maxBytes: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  acceptContentType: (type: string) => boolean;
}): Promise<HttpsReply> {
  const { signal, maxBytes } = options;
  if (signal.aborted) throw abortError(signal);
  const url = publicHttpsUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }]
    : await abortable(lookup(hostname, { all: true, verbatim: true }), signal);
  if (signal.aborted) throw abortError(signal);
  if (!addresses.length || addresses.some(({ address, family }) => !isPublicAddress(address) || isIP(address) !== family)) throw blockedUrl();
  const pinned = addresses.find(a => a.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: options.method ?? "GET",
      agent: false,
      family: pinned.family,
      // Never inherit proxy/environment routing, cookies, auth, or a shared agent.
      lookup: (_host, _opts, callback) => callback(null, pinned.address, pinned.family),
      headers: {
        "User-Agent": "Vivic-Search-PoC/0.6",
        "Accept-Encoding": "identity",
        ...options.headers,
      },
      signal,
      maxHeaderSize: 16 * 1024,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const location = res.headers.location;
      const fail = (error: SearchError) => { res.destroy(); req.destroy(); reject(error); };
      // Cancel error/redirect bodies without buffering or draining an unbounded stream.
      if (status < 200 || status >= 300) {
        res.destroy();
        resolve({ status, contentType, location, body: Buffer.alloc(0) });
        return;
      }
      if (!options.acceptContentType(contentType)) {
        fail(new SearchError("search-unsupported-content", "网页响应不是支持的文本类型。", 415)); return;
      }
      if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
        fail(new SearchError("search-unsupported-content", "不接受压缩网页响应。", 415)); return;
      }
      const length = res.headers["content-length"];
      if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        fail(new SearchError("search-too-large", "网页响应超过大小限制。", 413)); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { fail(new SearchError("search-too-large", "网页响应超过大小限制。", 413)); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, contentType, location, body: Buffer.concat(chunks) }));
      res.on("error", reject);
      res.on("aborted", () => reject(new SearchError("search-unavailable", "网页连接中断。", 502)));
    });
    req.on("error", error => reject(signal.aborted ? abortError(signal) : error));
    req.end(options.body);
  });
}
