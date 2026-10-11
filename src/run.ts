import type { ScanOutput } from "@shareglow/scan-rules";
import { renderComment, MARKER, pageFails, type FailOn, type PageResult } from "./comment.ts";
import { assertHttpBase, HttpError, request } from "./http.ts";

/** Hard cap on pages per run: every scan is a metered API call. */
export const MAX_PAGES = 20;

export interface RunEnv {
  SHAREGLOW_API_KEY?: string;
  SHAREGLOW_URLS?: string;
  SHAREGLOW_GITHUB_TOKEN?: string;
  SHAREGLOW_FAIL_ON?: string;
  SHAREGLOW_COMMENT?: string;
  SHAREGLOW_API_URL?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_API_URL?: string;
}

export interface RunDeps {
  env: RunEnv;
  fetch: typeof fetch;
  /** Reads the webhook event payload JSON (injected for tests). */
  readEvent: (path: string) => unknown;
  log: (line: string) => void;
}

export interface RunResult {
  exitCode: 0 | 1;
  body: string;
  commentAction: "created" | "updated" | "skipped";
}

function parseUrls(raw: string | undefined): string[] {
  const urls = [
    ...new Set(
      (raw ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ];
  if (urls.length === 0) throw new HttpError("Input `urls` is empty.");
  if (urls.length > MAX_PAGES) throw new HttpError(`At most ${MAX_PAGES} pages per run.`);
  for (const url of urls) assertHttpBase(url, `URL "${url}"`);
  return urls;
}

async function scanPage(deps: RunDeps, api: string, key: string, url: string): Promise<PageResult> {
  try {
    const res = await request(deps.fetch, `${api}/v1/scan`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: { url },
    });
    if (res.ok) return { url, ok: true, scan: res.json as ScanOutput };
    const message = (res.json as { error?: { message?: string } } | null)?.error?.message;
    return { url, ok: false, error: message ?? `Shareglow API answered ${res.status}.` };
  } catch (err) {
    return { url, ok: false, error: err instanceof Error ? err.message : "Scan failed." };
  }
}

interface IssueComment {
  id: number;
  body?: string;
}

/** Creates the comment, or edits the one that already carries the marker, so re-runs never add a second. */
async function upsertComment(
  deps: RunDeps,
  repo: string,
  prNumber: number,
  body: string,
): Promise<"created" | "updated"> {
  const api = assertHttpBase(deps.env.GITHUB_API_URL ?? "https://api.github.com", "GITHUB_API_URL");
  const headers = {
    authorization: `Bearer ${deps.env.SHAREGLOW_GITHUB_TOKEN ?? ""}`,
    accept: "application/vnd.github+json",
  };
  const base = `${api}/repos/${repo}/issues`;
  for (let page = 1; page <= 20; page++) {
    const res = await request(deps.fetch, `${base}/${prNumber}/comments?per_page=100&page=${page}`, {
      method: "GET",
      headers,
    });
    if (!res.ok) throw new HttpError(`GitHub answered ${res.status} while listing comments.`, res.status);
    const comments = res.json as IssueComment[];
    const existing = comments.find((c) => c.body?.includes(MARKER));
    if (existing) {
      const patch = await request(deps.fetch, `${base}/comments/${existing.id}`, {
        method: "PATCH",
        headers,
        body: { body },
      });
      if (!patch.ok) throw new HttpError(`GitHub answered ${patch.status} while updating the comment.`, patch.status);
      return "updated";
    }
    if (comments.length < 100) break;
  }
  const post = await request(deps.fetch, `${base}/${prNumber}/comments`, { method: "POST", headers, body: { body } });
  if (!post.ok) throw new HttpError(`GitHub answered ${post.status} while creating the comment.`, post.status);
  return "created";
}

function prNumberOf(deps: RunDeps): number | null {
  const path = deps.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  const event = deps.readEvent(path) as { pull_request?: { number?: number }; number?: number } | null;
  return event?.pull_request?.number ?? null;
}

export async function run(deps: RunDeps): Promise<RunResult> {
  const key = deps.env.SHAREGLOW_API_KEY;
  if (!key) throw new HttpError("Input `api-key` is required.");
  const failOn = (deps.env.SHAREGLOW_FAIL_ON || "error") as FailOn;
  if (!["error", "warning", "never"].includes(failOn))
    throw new HttpError("`fail-on` must be error, warning or never.");
  const api = assertHttpBase(deps.env.SHAREGLOW_API_URL || "https://app.getshareglow.com", "api-url");
  const urls = parseUrls(deps.env.SHAREGLOW_URLS);

  const pages: PageResult[] = [];
  for (const url of urls) {
    const page = await scanPage(deps, api, key, url);
    deps.log(`${pageFails(page, failOn) ? "FAIL" : "ok  "} ${url}`);
    pages.push(page);
  }
  const body = renderComment(pages, failOn);

  let commentAction: RunResult["commentAction"] = "skipped";
  const repo = deps.env.GITHUB_REPOSITORY;
  const pr = prNumberOf(deps);
  if (deps.env.SHAREGLOW_COMMENT !== "false" && repo && pr !== null) {
    commentAction = await upsertComment(deps, repo, pr, body);
    deps.log(`PR comment ${commentAction}.`);
  } else {
    deps.log("No pull request context (or comment=false): comment skipped.");
  }
  return { exitCode: pages.some((p) => pageFails(p, failOn)) ? 1 : 0, body, commentAction };
}
