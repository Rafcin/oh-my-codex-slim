const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return mergeObjects({}, value);
}

function mergeObjects(base, override) {
  const result = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(override)])) {
    if (blockedKeys.has(key)) continue;
    const hasOverride = Object.hasOwn(override, key);
    const baseValue = base[key];
    const overrideValue = override[key];
    result[key] = hasOverride && isPlainObject(baseValue) && isPlainObject(overrideValue)
      ? mergeObjects(baseValue, overrideValue)
      : clone(hasOverride ? overrideValue : baseValue);
  }
  return result;
}

export function mergeConfig(base, override) {
  return mergeObjects(base, override);
}
