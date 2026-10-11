// Entrypoint of the composite action: `node src/main.ts` (Node 22+ strips the types itself).
import { appendFileSync, readFileSync } from "node:fs";
import { HttpError } from "./http.ts";
import { run, type RunEnv } from "./run.ts";

const env = process.env as RunEnv;
// Never let the key reach the log, even if a later step echoes it.
if (env.SHAREGLOW_API_KEY) console.log(`::add-mask::${env.SHAREGLOW_API_KEY}`);

try {
  const result = await run({
    env,
    fetch,
    readEvent: (path) => JSON.parse(readFileSync(path, "utf8")),
    log: (line) => console.log(line),
  });
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `result=${result.exitCode === 0 ? "pass" : "fail"}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, result.body);
  if (result.exitCode !== 0) console.log("::error::Shareglow found pages with missing or broken Open Graph tags.");
  process.exitCode = result.exitCode;
} catch (err) {
  console.log(`::error::${err instanceof HttpError || err instanceof Error ? err.message : "Unexpected failure."}`);
  process.exitCode = 1;
}
