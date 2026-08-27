import assert from "node:assert/strict";
import { join } from "node:path";
import { grade, moduleUrl, workspace } from "./lib.mjs";

await grade(["src/path.js", "test/"], async () => {
  const { resolveArtifactPath } = await import(moduleUrl("src/path.js"));
  const root = join(workspace, "artifacts");
  assert.equal(resolveArtifactPath(root, "nested/report.json"), join(root, "nested", "report.json"));
  for (const unsafe of ["", "../outside", "nested/../../outside", join(workspace, "absolute"), "..\\outside", "safe\0outside"]) {
    assert.throws(() => resolveArtifactPath(root, unsafe));
  }
  assert.throws(() => resolveArtifactPath(join(workspace, "art"), "../artifact-secret/file"));
});
