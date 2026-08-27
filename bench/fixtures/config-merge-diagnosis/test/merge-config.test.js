import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConfig } from "../src/merge-config.js";

test("overrides top-level values", () => {
  assert.deepEqual(mergeConfig({ profile: "fast" }, { profile: "auto" }), { profile: "auto" });
});

test("preserves nested defaults", () => {
  assert.deepEqual(
    mergeConfig({ agent: { model: "base", effort: "low" } }, { agent: { effort: "high" } }),
    { agent: { model: "base", effort: "high" } }
  );
});
