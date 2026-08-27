import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { resolveArtifactPath } from "../src/path.js";

test("resolves a nested artifact", () => {
  assert.equal(resolveArtifactPath("/tmp/artifacts", "nested/report.json"), join("/tmp/artifacts", "nested", "report.json"));
});
