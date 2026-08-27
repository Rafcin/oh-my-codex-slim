export function parseQuery(input) {
  const result = {};
  for (const part of input.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const [rawKey, rawValue = ""] = part.split("=");
    result[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
  }
  return result;
}
