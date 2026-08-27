import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { grade, workspace } from "./lib.mjs";

await grade(["README.md"], async () => {
  const content = await readFile(join(workspace, "README.md"), "utf8");
  for (const required of ["fast", "auto", "thorough", "solo", "delegate", "audit", "full", "source verification", "isolated", "runtime verification", "credentials", "receipt"]) {
    assert.match(content.toLowerCase(), new RegExp(`\\b${required}\\b`));
  }
  assert.match(content, /```mermaid[\s\S]+intake[\s\S]+verification[\s\S]+```/i);
  assert.doesNotMatch(content, /telemetry|stores? (?:api )?keys?|supported providers?:/i);
});
