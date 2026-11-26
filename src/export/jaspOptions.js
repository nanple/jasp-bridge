/**
 * Convert jasp-bridge's headless request options into the option format the
 * JASP desktop expects inside a ".jasp" archive.
 *
 * In the archive every *variable* option is stored as
 *     { "types": ["nominal"], "value": ["gender"] }
 * and every *collection* option as
 *     { "optionKey": "components", "types": [...], "value": [ ... ] }
 * while lists of variables (e.g. repeatedMeasuresCells) stay plain arrays.
 */

// Collections that keep their own option key inside the archive.
const COLLECTION_KEYS = {
  modelTerms: "components",
  withinModelTerms: "components",
  betweenModelTerms: "components",
  singleModelTerms: "components",
  postHocTerms: "variable",
  contrasts: "variable",
  marginalMeanTerms: "variable",
  restrictedMarginalMeanTerms: "variable",
  timings: "variable",
};

// Lists of variables that stay plain arrays inside the archive.
const PLAIN_LIST_KEYS = new Set([
  "repeatedMeasuresCells",
  "repeatedMeasuresFactors",
  "customContrasts",
  "processModels",
  "factors",
  "models",
  "pairs",
]);

// Plain lists that still reference variables and therefore need encoding.
const ENCODE_PLAIN_KEYS = new Set([
  "repeatedMeasuresCells",
  "repeatedMeasuresFactors",
  "customContrasts",
]);

// Nested variable options inside the plain lists above.
const NESTED_VARIABLE_KEYS = new Set([
  "modelNumberIndependent",
  "modelNumberMediators",
  "modelNumberModeratorW",
  "modelNumberModeratorZ",
  "processDependent",
  "processIndependent",
  "processVariable",
  "indicators",
  "variables",
  "dependent",
  "group",
]);

function asTypes(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function typeOfName(types, name) {
  if (!name) return "unknown";
  const type = types.get(String(name).toLowerCase());
  return type || "unknown";
}

function termTypes(types, components) {
  const list = asTypes(components);
  if (list.length === 0) return [];
  const resolved = list.map((name) => typeOfName(types, name));
  return list.length === 1 ? resolved[0] : resolved;
}

function normaliseNested(value, types) {
  if (Array.isArray(value)) {
    return value.map((item) => normaliseNested(item, types));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (NESTED_VARIABLE_KEYS.has(key) && (typeof item === "string" || Array.isArray(item))) {
        const list = asTypes(item);
        out[key] = {
          types: list.map((name) => typeOfName(types, name)),
          value: item,
        };
        continue;
      }
      out[key] = normaliseNested(item, types);
    }
    return out;
  }
  return value;
}

function normaliseCollectionItem(key, item, types) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  if (Array.isArray(out.variable)) {
    out.variable = [...out.variable];
  } else if (typeof out.variable === "string") {
    out.variable = [out.variable];
  }
  if (Array.isArray(out.components)) {
    out.components = [...out.components];
    // The desktop format names the referenced variable "variable" for
    // post-hoc / marginal-mean collections (not "components").
    if ((key === "postHocTerms" || key === "marginalMeanTerms") && !out.variable) {
      out.variable = [...out.components];
      delete out.components;
    }
  }
  if (key === "processModels" || key === "models") {
    if (typeof out.name === "string") out.name = [out.name];
  }
  return out;
}

function collectionTypes(key, value, types) {
  const items = asTypes(value);
  return items.map((item) => {
    if (!item || typeof item !== "object") return "unknown";
    if (Array.isArray(item.components)) return termTypes(types, item.components);
    if (Array.isArray(item.variable)) return termTypes(types, item.variable);
    if (typeof item.variable === "string") return typeOfName(types, item.variable);
    return "unknown";
  });
}

/**
 * @param {object} options headless request options
 * @param {Map<string,string>} types column name -> scale|nominal|ordinal
 */
export function toJaspOptions(options = {}, types = new Map()) {
  const out = {};
  const encodeKeys = new Set();

  for (const [key, value] of Object.entries(options)) {
    if (key.endsWith(".types")) continue;

    const companion = options[`${key}.types`];
    if (companion !== undefined && !PLAIN_LIST_KEYS.has(key)) {
      out[key] = { types: asTypes(companion), value };
      encodeKeys.add(key);
      continue;
    }

    if (COLLECTION_KEYS[key]) {
      out[key] = {
        optionKey: COLLECTION_KEYS[key],
        types: collectionTypes(key, value, types),
        value: asTypes(value).map((item) => normaliseCollectionItem(key, item, types)),
      };
      encodeKeys.add(key);
      continue;
    }

    if (PLAIN_LIST_KEYS.has(key)) {
      out[key] = normaliseNested(value, types);
      if (ENCODE_PLAIN_KEYS.has(key)) encodeKeys.add(key);
      continue;
    }

    out[key] = value;
  }

  if (encodeKeys.size > 0) {
    out[".meta"] = Object.fromEntries(
      [...encodeKeys].map((key) => [key, { shouldEncode: true }])
    );
  }
  return out;
}
