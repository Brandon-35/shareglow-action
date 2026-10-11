// Every outbound request of the action goes through here: timeout, size cap, no redirects.
// The action only talks to two configured origins (the Shareglow API and the GitHub API); the page
// URLs a user lists are fetched by the Shareglow scanner, which owns the SSRF guard.
const TIMEOUT_MS = 30_000;
const MAX_BYTES = 1024 * 1024;

export class HttpError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface HttpResult {
  status: number;
  ok: boolean;
  json: unknown;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new HttpError("Response too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Validates an http(s) base URL (a path such as GHES `/api/v3` is kept) and drops the trailing slash. */
export function assertHttpBase(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(`${label} is not a valid URL.`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new HttpError(`${label} must be an http(s) URL without credentials.`);
  }
  return url.href.replace(/\/+$/, "");
}

/** The thrown message never contains headers, so a token or API key cannot leak into the log. */
export async function request(
  fetchFn: typeof fetch,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown },
): Promise<HttpResult> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: init.method,
      headers: { "content-type": "application/json", ...init.headers },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new HttpError(`Could not reach ${new URL(url).origin}.`);
  }
  const text = await readCapped(res);
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body: leave json null
  }
  return { status: res.status, ok: res.ok, json };
}
