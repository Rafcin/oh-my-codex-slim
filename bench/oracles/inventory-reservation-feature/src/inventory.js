function assertQuantity(quantity, label) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`invalid quantity for ${label}`);
}

export function reserveInventory(inventory, request) {
  for (const [sku, quantity] of Object.entries(inventory)) assertQuantity(quantity, sku);
  const allocations = [];
  for (const [sku, quantity] of Object.entries(request)) {
    assertQuantity(quantity, sku);
    if (!Object.hasOwn(inventory, sku)) throw new Error(`unknown SKU: ${sku}`);
    if (inventory[sku] < quantity) throw new Error(`insufficient inventory: ${sku}`);
    allocations.push({ sku, quantity });
  }
  const nextInventory = { ...inventory };
  for (const { sku, quantity } of allocations) nextInventory[sku] -= quantity;
  return { inventory: nextInventory, allocations };
}
