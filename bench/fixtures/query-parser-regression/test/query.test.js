import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQuery } from "../src/query.js";

test("parses a basic query", () => {
  assert.deepEqual(parseQuery("name=codex&mode=fast"), { name: "codex", mode: "fast" });
});
