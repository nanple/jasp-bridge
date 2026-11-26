/**
 * Some MCP hosts (including WorkBuddy in practice) rewrite JSON arrays of
 * strings as objects ({"0":"a","1":"b"}) and booleans as "true"/"false"
 * strings. JASP's R layer then dies on `!optionToCheck` if a boolean option
 * arrives as a string. Normalize these back before schema validation and
 * before a request is sent to the engine.
 */

export function isArrayLikeObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (keys.some((key) => !/^(0|[1-9]\d*)$/.test(key))) return false;
  const indexes = keys.map((key) => Number(key)).sort((a, b) => a - b);
  return indexes[0] === 0 && indexes.every((index, i) => index === i);
}

export function coerceStringArray(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (isArrayLikeObject(value)) {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => String(value[key]));
  }
  return [String(value)];
}

export function coerceVariableRoles(input = {}) {
  if (input === null || input === undefined || input === "") return {};
  if (Array.isArray(input) || isArrayLikeObject(input)) {
    const list = coerceStringArray(input).filter(Boolean);
    return list.length > 0 ? { variables: list } : {};
  }
  if (typeof input !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const list = coerceStringArray(value).filter(Boolean);
    if (list.length > 0) result[key] = list;
  }
  return result;
}

export function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}

export function coerceBooleanInput(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return coerceBoolean(value);
}

export function coerceOptionValue(value) {
  if (typeof value === "string") return coerceBoolean(value);
  if (Array.isArray(value)) {
    return value.map((item) => (item && typeof item === "object" ? coerceOptionValue(item) : item));
  }
  if (isArrayLikeObject(value)) {
    const list = Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key]);
    return coerceOptionValue(list);
  }
  if (value && typeof value === "object") return coerceOptions(value);
  return value;
}

export function coerceOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options) || isArrayLikeObject(options)) {
    return options;
  }
  const next = {};
  for (const [key, value] of Object.entries(options)) {
    next[key] = coerceOptionValue(value);
  }
  return next;
}
