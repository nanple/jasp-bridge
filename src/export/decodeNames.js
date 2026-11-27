/**
 * Map JASP's temporary encoded column names (jaspColumn1, …) back to the
 * user's original variable names. Used when writing .jasp archives so the
 * tables and plot titles inside the file match the data columns.
 *
 * Replacement is longest-token first and never treats "jaspColumn2" as a
 * prefix of "jaspColumn21", so internal object ids such as
 * "..._jaspColumn21" stay intact unless that exact encoded name is in the map.
 */

export function normalizeEncodingMap(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((row) => ({
        original: String(row?.original ?? row?.orig ?? ""),
        encoded: String(row?.encoded ?? ""),
      }))
      .filter((row) => row.original && row.encoded);
  }
  if (typeof raw === "object" && Array.isArray(raw.original) && Array.isArray(raw.encoded)) {
    return raw.encoded
      .map((encoded, index) => ({
        original: String(raw.original[index] ?? ""),
        encoded: String(encoded ?? ""),
      }))
      .filter((row) => row.original && row.encoded);
  }
  return [];
}

export function decodeEncodedString(value, mapping) {
  if (typeof value !== "string" || mapping.length === 0) return value;
  let out = value;
  const sorted = [...mapping].sort((a, b) => b.encoded.length - a.encoded.length);
  for (const { original, encoded } of sorted) {
    const escaped = encoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`, "g"), original);
  }
  return out;
}

export function decodeEncodedNames(value, rawMap) {
  const mapping = normalizeEncodingMap(rawMap);
  if (mapping.length === 0) return value;
  const walk = (node) => {
    if (typeof node === "string") return decodeEncodedString(node, mapping);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        out[decodeEncodedString(key, mapping)] = walk(child);
      }
      return out;
    }
    return node;
  };
  return walk(value);
}

/**
 * A "variable label" that is actually one of the value codes (e.g. "0")
 * is not a usable display title; keep the column name instead.
 */
export function columnDisplayTitle(column) {
  const name = column?.name;
  const title = column?.title ?? column?.label;
  if (!title) return name;
  const text = String(title).trim();
  if (!text || text === name) return name;
  const valueLabels = column?.valueLabels;
  if (valueLabels && typeof valueLabels === "object") {
    if (Object.prototype.hasOwnProperty.call(valueLabels, text)) return name;
  }
  return text;
}
