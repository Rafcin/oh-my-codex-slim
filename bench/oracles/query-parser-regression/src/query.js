const blockedKeys = new Set(["__proto__", "constructor", "prototype"]);

function decode(value) {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

export function parseQuery(input) {
  const result = {};
  for (const part of input.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? "" : part.slice(separator + 1);
    const key = decode(rawKey);
    if (blockedKeys.has(key)) continue;
    const value = decode(rawValue);
    const previous = result[key];
    if (previous === undefined) result[key] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else result[key] = [previous, value];
  }
  return result;
}
