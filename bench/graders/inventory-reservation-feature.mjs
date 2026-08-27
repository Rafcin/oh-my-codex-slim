import assert from "node:assert/strict";
import { grade, moduleUrl } from "./lib.mjs";

await grade(["src/inventory.js", "test/"], async () => {
  const { reserveInventory } = await import(moduleUrl("src/inventory.js"));
  const inventory = { alpha: 5, beta: 3, untouched: 9 };
  const result = reserveInventory(inventory, { beta: 2, alpha: 4 });
  assert.deepEqual(result, {
    inventory: { alpha: 1, beta: 1, untouched: 9 },
    allocations: [{ sku: "beta", quantity: 2 }, { sku: "alpha", quantity: 4 }]
  });
  assert.deepEqual(inventory, { alpha: 5, beta: 3, untouched: 9 });
  for (const request of [{ alpha: 6 }, { missing: 1 }, { alpha: 0 }, { alpha: 1.5 }, { alpha: Number.MAX_SAFE_INTEGER + 1 }]) {
    const snapshot = structuredClone(inventory);
    assert.throws(() => reserveInventory(inventory, request));
    assert.deepEqual(inventory, snapshot);
  }
  for (const invalidInventory of [{ alpha: 0 }, { alpha: -1 }, { alpha: 1.5 }, { alpha: Number.MAX_SAFE_INTEGER + 1 }]) {
    const snapshot = structuredClone(invalidInventory);
    assert.throws(() => reserveInventory(invalidInventory, { alpha: 1 }));
    assert.deepEqual(invalidInventory, snapshot);
  }
});
