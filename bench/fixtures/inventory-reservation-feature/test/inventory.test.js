import assert from "node:assert/strict";
import { test } from "node:test";
import { reserveInventory } from "../src/inventory.js";

test("reserves available inventory", () => {
  assert.deepEqual(reserveInventory({ alpha: 3 }, { alpha: 2 }), {
    inventory: { alpha: 1 }, allocations: [{ sku: "alpha", quantity: 2 }]
  });
});
