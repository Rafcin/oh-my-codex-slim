import assert from "node:assert/strict";
import { grade, moduleUrl } from "./lib.mjs";

await grade(["src/merge-config.js", "test/"], async () => {
  const { mergeConfig } = await import(moduleUrl("src/merge-config.js"));
  const base = { agent: { model: "base", tools: ["read"], nested: { a: 1 } }, untouched: true };
  const override = JSON.parse('{"agent":{"tools":["read","write"],"nested":{"b":2}},"nullable":null,"__proto__":{"polluted":true},"constructor":{"prototype":{"constructed":true}},"prototype":{"leaked":true}}');
  const merged = mergeConfig(base, override);
  assert.deepEqual(merged, {
    agent: { model: "base", tools: ["read", "write"], nested: { a: 1, b: 2 } },
    untouched: true,
    nullable: null
  });
  merged.agent.tools.push("mutated");
  merged.agent.nested.a = 99;
  assert.deepEqual(base.agent, { model: "base", tools: ["read"], nested: { a: 1 } });
  assert.deepEqual(override.agent.tools, ["read", "write"]);
  assert.equal({}.polluted, undefined);
  assert.equal({}.constructed, undefined);
  assert.equal(Object.hasOwn(merged, "__proto__"), false);
  assert.equal(Object.hasOwn(merged, "constructor"), false);
  assert.equal(Object.hasOwn(merged, "prototype"), false);
});
