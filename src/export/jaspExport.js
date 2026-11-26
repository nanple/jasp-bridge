import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

import jaspDefaults from "./jaspDefaults.json" with { type: "json" };
import { buildJaspArchive } from "./jaspWriter.js";
import { toJaspOptions } from "./jaspOptions.js";

export function parseJsonField(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
}

/**
 * Collect viewer results, the official internal jaspResults object, and extra
 * resource files (plots) from a run's result.json and resources/ directory.
 */
export function collectJaspRunArtifacts(result, runDir) {
  const viewer = parseJsonField(result?.jasp_results_json);
  let jaspResults = parseJsonField(result?.jasp_internal_json);
  const resources = [];
  const seen = new Set();

  const addDir = (dir, prefix = "") => {
    if (!dir || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        addDir(full, rel);
        continue;
      }
      if (entry.name === "jaspResults.json") {
        if (!jaspResults) {
          try {
            jaspResults = JSON.parse(fs.readFileSync(full, "utf8"));
          } catch {
            // ignore unreadable official results
          }
        }
        continue;
      }
      if (entry.name === "jaspResultsFinishedWriting.txt") continue;
      if (seen.has(rel)) continue;
      seen.add(rel);
      resources.push({ name: rel, data: fs.readFileSync(full) });
    }
  };

  if (runDir) {
    const idDir = path.join(runDir, "resources", "0");
    const resourceRoot = path.join(runDir, "resources");
    if (fs.existsSync(idDir)) addDir(idDir);
    else if (fs.existsSync(resourceRoot)) addDir(resourceRoot);
  }

  return { results: viewer || null, jaspResults: jaspResults || null, resources };
}

/**
 * Turn a session dataset + analysis plan into a real JASP ".jasp" archive.
 *
 * When a completed run is available, the archive embeds the viewer results
 * (analyses.json) and the official internal jaspResults object
 * (resources/0/jaspResults.json) so JASP can show results on open.
 */
export function buildJaspFile({
  session,
  plan,
  request,
  dataPath,
  description = "",
  results = null,
  jaspResults = null,
  resources = [],
}) {
  const raw = fs.readFileSync(dataPath, "utf8");
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true });
  const names = records.length > 0 ? Object.keys(records[0]) : [];
  const dictionary = new Map(
    (session?.data?.variables || []).map((variable) => [variable.name, variable])
  );
  const typeIndex = new Map(
    (session?.data?.variables || []).map((variable) => [
      variable.name.toLowerCase(),
      variable.type || "scale",
    ])
  );

  const columns = names.map((name) => {
    const variable = dictionary.get(name);
    return {
      name,
      type: variable?.type || "scale",
      // Labels are derived from the data itself (order of appearance), which
      // matches how JASP imports a CSV.
      labels: undefined,
      description: variable?.label && variable.label !== name ? variable.label : "",
    };
  });

  const rows = records.map((record) =>
    columns.map((column) => {
      const value = record[column.name];
      if (value === undefined || value === null || value === "") return null;
      if (column.type === "scale") {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      }
      return String(value);
    })
  );

  // Start from the module's default option set (harvested from the official
  // JASP examples) and overlay our own options, so the engine sees a complete
  // option set like in the JASP GUI.
  const template = jaspDefaults[request.name] || null;
  const base = { ...(template?.options || {}) };
  const meta = { ...(template?.meta || {}) };
  const ours = toJaspOptions(request.options || {}, typeIndex);
  for (const [key, value] of Object.entries(ours)) {
    if (key === ".meta") continue;
    base[key] = value;
  }
  for (const key of Object.keys(ours[".meta"] || {})) meta[key] = { shouldEncode: true };
  base[".meta"] = meta;

  const analyses = [
    {
      id: 0,
      name: request.name,
      module: request.module || "",
      moduleVersion: template?.moduleVersion || "",
      title: plan?.label || request.name,
      options: base,
      results: results || {},
      jaspResults: jaspResults || null,
      resources,
      columns: names,
    },
  ];

  return buildJaspArchive({ columns, rows, analyses, description });
}
