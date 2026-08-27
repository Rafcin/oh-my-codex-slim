import assert from "node:assert/strict";
import { grade, moduleUrl } from "./lib.mjs";

await grade(["src/query.js", "test/"], async () => {
  const { parseQuery } = await import(moduleUrl("src/query.js"));
  assert.deepEqual(parseQuery("tag=one&tag=two&message=hello+world&flag"), {
    tag: ["one", "two"], message: "hello world", flag: ""
  });
  const result = parseQuery("__proto__=polluted&constructor=bad&prototype=no&safe=yes");
  assert.deepEqual(result, { safe: "yes" });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(parseQuery("encoded=%E2%9C%93&empty="), { encoded: "✓", empty: "" });
});
