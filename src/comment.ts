import type { ScanOutput } from "@shareglow/scan-rules";

/** Hidden marker: the one comment per PR is found by this, never by author or position. */
export const MARKER = "<!-- shareglow-preview -->";

export type PageResult = { url: string; ok: true; scan: ScanOutput } | { url: string; ok: false; error: string };

export type FailOn = "error" | "warning" | "never";

/** A scanned page fails when it has an error (or a warning, with fail-on=warning); an unscannable page always fails. */
export function pageFails(page: PageResult, failOn: FailOn): boolean {
  if (!page.ok) return failOn !== "never";
  if (failOn === "never") return false;
  return page.scan.errors > 0 || (failOn === "warning" && page.scan.warnings > 0);
}

const cell = (text: string): string =>
  text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
/** Markdown image destinations must not contain spaces or parentheses. */
const imageDest = (url: string): string => url.replace(/[ ()]/g, (c) => encodeURIComponent(c));

function pageSection(page: PageResult, failed: boolean): string {
  const icon = failed ? "❌" : "✅";
  if (!page.ok) return `### ${icon} ${page.url}\n\nCould not scan this page: ${cell(page.error)}\n`;
  const { scan } = page;
  const lines = [
    `### ${icon} ${page.url}`,
    "",
    `Score **${scan.score}/100** · ${scan.errors} errors · ${scan.warnings} warnings`,
    "",
  ];
  const image = scan.preview.image;
  lines.push(image ? `![preview](${imageDest(image)})` : "_No og:image found on this page._", "");
  if (scan.issues.length > 0) {
    lines.push("| Tag | Severity | Problem |", "| --- | --- | --- |");
    for (const issue of scan.issues) lines.push(`| ${cell(issue.tag)} | ${issue.severity} | ${cell(issue.message)} |`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderComment(pages: PageResult[], failOn: FailOn): string {
  const failures = pages.filter((p) => pageFails(p, failOn)).length;
  const header =
    failures === 0
      ? "## ✅ Shareglow preview: all pages pass"
      : `## ❌ Shareglow preview: ${failures} of ${pages.length} pages failing`;
  return [MARKER, header, "", ...pages.map((p) => pageSection(p, pageFails(p, failOn)))].join("\n").trimEnd() + "\n";
}
