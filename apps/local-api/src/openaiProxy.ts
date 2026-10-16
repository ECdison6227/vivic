import { execFileSync } from "node:child_process";
import { Agent, Dispatcher, ProxyAgent, interceptors, setGlobalDispatcher } from "undici";

/**
 * OpenAI egress. Node's fetch ignores the system proxy, so on a machine whose
 * direct exit is in an unsupported region every OpenAI call (OAuth token
 * exchange, refresh, model catalog, inference) fails with HTTP 403
 * `unsupported_country_region_territory` while the browser — which does use
 * the proxy — happily completes the authorization page.
 *
 * Only OpenAI/ChatGPT hosts are routed through a proxy; StepFun and every
 * other origin keep their direct connection.
 */

const OPENAI_DOMAINS = ["openai.com", "chatgpt.com"];
const SYSTEM_PROXY_TTL_MS = 30_000;
/**
 * Desktop proxy apps often stall the first tunnel while picking a node. Only
 * connect-phase failures are retried: the request never reached OpenAI, so
 * even a single-use OAuth authorization code is safe to resend.
 */
const CONNECT_RETRY = {
  maxRetries: 2, minTimeout: 300, timeoutFactor: 2, statusCodes: [],
  methods: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"] as Dispatcher.HttpMethod[],
  errorCodes: ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED"],
};

export const isOpenAIHost = (host: string): boolean => {
  const name = host.toLowerCase().replace(/\.$/, "");
  return OPENAI_DOMAINS.some(domain => name === domain || name.endsWith(`.${domain}`));
};

const withScheme = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Windows `ProxyServer` is either `host:port` (all protocols) or a list such
 * as `http=h:p;https=h:p;socks=h:p`. SOCKS-only entries are not usable here.
 */
export const parseWindowsProxyServer = (value: string): string | undefined => {
  const entries = value.split(";").map(part => part.trim()).filter(Boolean);
  if (entries.length === 1 && !entries[0]!.includes("=")) return withScheme(entries[0]!);
  const byScheme = new Map(entries.map(entry => {
    const [scheme, address = ""] = entry.split("=", 2);
    return [scheme!.trim().toLowerCase(), address.trim()] as const;
  }));
  const address = byScheme.get("https") || byScheme.get("http");
  return address ? withScheme(address) : undefined;
};

const readWindowsSystemProxy = (): string | undefined => {
  if (process.platform !== "win32") return undefined;
  try {
    const output = execFileSync("reg", [
      "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    ], { encoding: "utf8", timeout: 3000, windowsHide: true });
    const value = (name: string) => new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "mi").exec(output)?.[1]?.trim();
    if (Number(value("ProxyEnable")) !== 1) return undefined;
    const server = value("ProxyServer");
    return server ? parseWindowsProxyServer(server) : undefined;
  } catch {
    return undefined;
  }
};

export type ProxySource = "VIVIC_OPENAI_PROXY" | "env" | "system";
export interface ResolvedProxy { url: string; source: ProxySource }

/** `VIVIC_OPENAI_PROXY=direct` opts out; otherwise explicit > env > system. */
export const resolveOpenAIProxy = (
  env: NodeJS.ProcessEnv,
  readSystem: () => string | undefined = readWindowsSystemProxy,
): ResolvedProxy | undefined => {
  const explicit = env.VIVIC_OPENAI_PROXY?.trim();
  if (explicit && /^(direct|off|none)$/i.test(explicit)) return undefined;
  if (explicit) {
    const url = withScheme(explicit);
    return url ? { url, source: "VIVIC_OPENAI_PROXY" } : undefined;
  }
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
    const url = env[name] ? withScheme(env[name]!) : undefined;
    if (url) return { url, source: "env" };
  }
  const system = readSystem();
  return system ? { url: system, source: "system" } : undefined;
};

/** Never log proxy credentials. */
export const redactProxy = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "<invalid>";
  }
};

export class OpenAIEgressDispatcher extends Dispatcher {
  readonly #direct: Dispatcher;
  readonly #resolve: () => ResolvedProxy | undefined;
  readonly #ttlMs: number;
  readonly #agents = new Map<string, Dispatcher>();
  #cached: { at: number; value: ResolvedProxy | undefined } | undefined;

  constructor(options: { resolve: () => ResolvedProxy | undefined; direct?: Dispatcher; ttlMs?: number }) {
    super();
    this.#resolve = options.resolve;
    this.#direct = options.direct ?? new Agent();
    this.#ttlMs = options.ttlMs ?? SYSTEM_PROXY_TTL_MS;
  }

  /** Re-read periodically so turning a proxy app on/off needs no restart. */
  current(): ResolvedProxy | undefined {
    const now = Date.now();
    if (!this.#cached || now - this.#cached.at >= this.#ttlMs) this.#cached = { at: now, value: this.#resolve() };
    return this.#cached.value;
  }

  route(origin: string | URL | undefined): Dispatcher {
    let host = "";
    try { host = origin ? new URL(origin).hostname : ""; } catch { /* direct */ }
    const proxy = host && isOpenAIHost(host) ? this.current() : undefined;
    if (!proxy) return this.#direct;
    let agent = this.#agents.get(proxy.url);
    if (!agent) { agent = new ProxyAgent(proxy.url).compose(interceptors.retry(CONNECT_RETRY)); this.#agents.set(proxy.url, agent); }
    return agent;
  }

  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    return this.route(options.origin).dispatch(options, handler);
  }

  override async close(): Promise<void> {
    await Promise.all([this.#direct.close(), ...[...this.#agents.values()].map(agent => agent.close())]);
  }

  override async destroy(): Promise<void> {
    await Promise.all([this.#direct.destroy(), ...[...this.#agents.values()].map(agent => agent.destroy())]);
  }
}

/** Installs the router as the process-wide fetch dispatcher; returns it. */
export const installOpenAIEgress = (env: NodeJS.ProcessEnv = process.env): OpenAIEgressDispatcher => {
  const dispatcher = new OpenAIEgressDispatcher({ resolve: () => resolveOpenAIProxy(env) });
  setGlobalDispatcher(dispatcher);
  return dispatcher;
};
