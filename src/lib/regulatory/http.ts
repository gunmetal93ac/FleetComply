/**
 * HTTP access for the regulatory monitor.
 *
 * - Only the official API hosts below may be contacted. Anything else is refused before a request is made.
 * - Requests are made one at a time with a minimum spacing, a timeout and a response-size cap.
 * - Failures and rate-limit responses are retried with exponential backoff (honouring Retry-After).
 * - A request that still fails throws SourceRequestError. Callers must record the failure — a failed
 *   request is never evidence that nothing changed.
 *
 * Response bodies are untrusted data: they are parsed as text/JSON only and never executed or interpreted.
 */

export const ALLOWED_HOSTS = ["www.ecfr.gov", "www.federalregister.gov"] as const;

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "error" }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface HttpOptions {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum time between the starts of two requests. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Total attempts per request, including the first. */
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBytes?: number;
  userAgent?: string;
}

export class SourceRequestError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly attempts: number,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "SourceRequestError";
  }
}

export interface RequestStats {
  requests: number;
  retries: number;
  failures: number;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export function assertAllowedUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SourceRequestError("Not a valid URL", url, 0);
  }
  if (u.protocol !== "https:" || !(ALLOWED_HOSTS as readonly string[]).includes(u.hostname))
    throw new SourceRequestError(`Refused: ${u.hostname} is not an approved regulatory source`, url, 0);
  return u;
}

/** Seconds or HTTP-date → milliseconds; undefined when absent or unparseable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(0, date - now), 120_000);
}

export class SourceHttpClient {
  readonly stats: RequestStats = { requests: 0, retries: 0, failures: 0 };
  private lastStart = 0;
  private readonly o: Required<HttpOptions>;

  constructor(options: HttpOptions = {}) {
    this.o = {
      fetchImpl: options.fetchImpl ?? ((url, init) => fetch(url, init)),
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      minIntervalMs: options.minIntervalMs ?? 500,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxAttempts: options.maxAttempts ?? 4,
      baseBackoffMs: options.baseBackoffMs ?? 1_500,
      maxBytes: options.maxBytes ?? 3_000_000,
      userAgent: options.userAgent ?? "FleetComply-RegulatoryMonitor/0.2 (compliance reference tool; automated daily check)",
    };
  }

  /** GET a URL from an approved source and return the body as text. Throws SourceRequestError after the last attempt. */
  async getText(url: string, accept = "*/*"): Promise<string> {
    assertAllowedUrl(url);
    let lastError = "unknown error";
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= this.o.maxAttempts; attempt++) {
      const wait = this.lastStart + this.o.minIntervalMs - Date.now();
      if (wait > 0) await this.o.sleep(wait);
      this.lastStart = Date.now();
      this.stats.requests++;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
      let backoff = this.o.baseBackoffMs * 2 ** (attempt - 1);
      try {
        const res = await this.o.fetchImpl(url, { headers: { accept, "user-agent": this.o.userAgent }, signal: controller.signal, redirect: "error" });
        lastStatus = res.status;
        if (res.ok) {
          const body = await res.text();
          if (body.length > this.o.maxBytes) throw new SourceRequestError(`Response larger than ${this.o.maxBytes} bytes`, url, attempt, res.status);
          return body;
        }
        lastError = `HTTP ${res.status}`;
        if (!RETRYABLE.has(res.status)) break; // 400, 404 … will not improve on retry
        backoff = retryAfterMs(res.headers.get("retry-after")) ?? backoff;
      } catch (e) {
        if (e instanceof SourceRequestError) throw e;
        lastError = controller.signal.aborted ? `timed out after ${this.o.timeoutMs} ms` : e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.o.maxAttempts) {
        this.stats.retries++;
        await this.o.sleep(backoff);
      }
    }
    this.stats.failures++;
    throw new SourceRequestError(lastError, url, this.o.maxAttempts, lastStatus);
  }

  async getJson<T>(url: string): Promise<T> {
    const body = await this.getText(url, "application/json");
    try {
      return JSON.parse(body) as T;
    } catch {
      this.stats.failures++;
      throw new SourceRequestError("Response was not valid JSON", url, 1);
    }
  }
}
