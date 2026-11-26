import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createZip } from "./zip.js";

/**
 * Write a modern JASP ".jasp" archive (archive version 6, JASP 0.99).
 *
 * Layout (reverse engineered from JASP 0.99 archives):
 *   analyses.json   – analysis registry (options + viewer results)
 *   manifest.json   – archive/version info
 *   index.html      – results shell
 *   internal.sqlite – DataSets / Filters / Columns / Labels / DataSet_1
 *   resources/N/jaspResults.json – internal jaspResults object (not the viewer JSON)
 *   resources/N/jaspResultsFinishedWriting.txt – official write seal
 *
 * The data columns are stored numerically; nominal & ordinal columns keep
 * their labels in the Labels table (values are the integer codes).
 */

const ARCHIVE_VERSION = "6";
const JASP_VERSION = "0.99";

export const JASP_RESULTS_SEAL =
  "Writing state, plot and jaspResults.json seems to have been successful!\n";

const SCHEMA = [
  `CREATE TABLE DataSets (
    id INTEGER PRIMARY KEY,
    dataFilePath TEXT,
    databaseJson TEXT,
    emptyValuesJson TEXT,
    revision INT DEFAULT 0,
    dataFileSynch INT,
    description TEXT,
    dataFileTimestamp INT,
    showRSyntax INT,
    csvDelimiter INT DEFAULT 0,
    importLocale TEXT DEFAULT "")`,
  `CREATE TABLE Filters (
    id INTEGER PRIMARY KEY,
    dataSet INT,
    rFilter TEXT,
    generatedFilter TEXT,
    constructorJson TEXT,
    constructorR TEXT,
    errorMsg TEXT,
    revision INT DEFAULT 0,
    name TEXT,
    FOREIGN KEY(dataSet) REFERENCES DataSets(id))`,
  `CREATE TABLE Columns (
    id INTEGER PRIMARY KEY,
    dataSet INT,
    name TEXT,
    title TEXT,
    description TEXT,
    columnType TEXT,
    colIdx INT,
    invalidated INT NULL,
    codeType TEXT NULL,
    rCode TEXT NULL,
    error TEXT NULL,
    constructorJson TEXT NULL,
    analysisId INT NULL,
    revision INT DEFAULT 0,
    emptyValuesJson TEXT,
    autoSortByValue INT,
    dropLevels INT,
    computeFilter TEXT DEFAULT "",
    hasLabels INT DEFAULT 0,
    FOREIGN KEY(dataSet) REFERENCES DataSets(id))`,
  `CREATE TABLE Labels (
    id INTEGER PRIMARY KEY,
    columnId INT,
    value INT,
    ordering INT,
    filterAllows INT,
    label TEXT,
    originalValueJson TEXT,
    description TEXT,
    userAdded INT DEFAULT 0,
    FOREIGN KEY(columnId) REFERENCES Columns(id))`,
];

const EMPTY_VALUES = JSON.stringify(
  { custom: true, strings: [".", "NA", "NaN", "nan"] },
  null,
  3
);

function isMissing(value) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

function normaliseType(type) {
  if (type === "nominal" || type === "ordinal") return type;
  return "scale";
}

function hasEntries(value) {
  return Boolean(value) && typeof value === "object" && Object.keys(value).length > 0;
}

function analysisResourceId(analysis, index) {
  if (Number.isInteger(analysis.id)) return analysis.id;
  return index;
}

function buildDataSet({ columns, rows, description }) {
  const nRows = rows.length;
  const labels = [];
  const prepared = columns.map((column, index) => {
    const values = rows.map((row) => row[index]);
    const type = normaliseType(column.type);
    if (type === "scale") {
      return {
        ...column,
        type,
        codes: values.map((value) => (isMissing(value) ? null : Number(value))),
      };
    }
    const source =
      Array.isArray(column.labels) && column.labels.length > 0
        ? column.labels
        : values.filter((value) => !isMissing(value)).map(String);
    const seen = new Map();
    const ordered = [];
    for (const value of source) {
      const key = String(value);
      if (!seen.has(key)) {
        seen.set(key, ordered.length + 1);
        ordered.push(key);
      }
    }
    labels.push({ columnId: index + 1, entries: ordered });
    return {
      ...column,
      type,
      codes: values.map((value) => (isMissing(value) ? null : seen.get(String(value)) ?? null)),
    };
  });

  const columnDefinitions = prepared
    .map((_, index) => `Column_${index + 1} NUM NULL`)
    .join(",\n    ");
  const dataTable = `CREATE TABLE DataSet_1 (rowNumber INTEGER PRIMARY KEY, Filter_1 INT NOT NULL DEFAULT 1, ${columnDefinitions})`;

  return { prepared, labels, nRows, dataTable };
}

export function buildJaspDatabase({ columns, rows, description = "" }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-db-"));
  const dbPath = path.join(work, "internal.sqlite");
  try {
    writeDatabase(dbPath, { columns, rows, description });
    return fs.readFileSync(dbPath);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function writeDatabase(dbPath, { columns, rows, description }) {
  const { prepared, labels, nRows, dataTable } = buildDataSet({ columns, rows, description });
  const db = new DatabaseSync(dbPath);

  for (const statement of SCHEMA) db.exec(statement);
  db.exec(dataTable);

  db.prepare(
    `INSERT INTO DataSets (id, dataFilePath, databaseJson, emptyValuesJson, revision, dataFileSynch,
       description, dataFileTimestamp, showRSyntax, csvDelimiter, importLocale)
     VALUES (1, '', 'null\n', ?, 1, 1, ?, 0, 0, 0, '')`
  ).run(EMPTY_VALUES, description || "");

  db.prepare(
    `INSERT INTO Filters (id, dataSet, rFilter, generatedFilter, constructorJson, constructorR, errorMsg, revision, name)
     VALUES (1, 1, '', 'generatedFilter <- rep(TRUE, rowcount)', '', '', 'null', 1, 'DEFAULT_FILTER')`
  ).run();

  const insertColumn = db.prepare(
    `INSERT INTO Columns (id, dataSet, name, title, description, columnType, colIdx, invalidated, codeType,
       rCode, error, constructorJson, analysisId, revision, emptyValuesJson, autoSortByValue, dropLevels,
       computeFilter, hasLabels)
     VALUES (?, 1, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL, 1, '', ?)`
  );

  const insertLabel = db.prepare(
    `INSERT INTO Labels (id, columnId, value, ordering, filterAllows, label, originalValueJson, description, userAdded)
     VALUES (?, ?, ?, ?, 1, ?, ?, '', 0)`
  );

  let labelId = 1;
  prepared.forEach((column, index) => {
    const hasLabels = column.type !== "scale";
    insertColumn.run(
      index + 1,
      column.name,
      column.name,
      column.description || "",
      column.type,
      index,
      hasLabels ? 1 : 0
    );
    const columnLabels = labels.find((entry) => entry.columnId === index + 1);
    if (columnLabels) {
      columnLabels.entries.forEach((label, ordering) => {
        insertLabel.run(labelId++, index + 1, ordering + 1, ordering, label, `${ordering + 1}\n`);
      });
    }
  });

  const placeholders = prepared.map((_, index) => `Column_${index + 1}`).join(", ");
  const insertRow = db.prepare(
    `INSERT INTO DataSet_1 (rowNumber, Filter_1, ${placeholders}) VALUES (?, 1, ${prepared
      .map(() => "?")
      .join(", ")})`
  );
  for (let rowIndex = 0; rowIndex < nRows; rowIndex += 1) {
    insertRow.run(rowIndex + 1, ...prepared.map((column) => column.codes[rowIndex]));
  }

  db.close();
  return { prepared, labels };
}

function buildAnalysesJson(analyses) {
  return {
    analyses: analyses.map((analysis, index) => {
      const results = analysis.results || {};
      const complete = hasEntries(results) || hasEntries(analysis.jaspResults);
      return {
        columns: analysis.columns || [],
        dynamicModule: {
          analysisEntry: analysis.name,
          moduleMaintainer: "JASP Team <info@jasp-stats.org>",
          moduleName: analysis.module || "",
          moduleVersion: analysis.moduleVersion || "0.99",
          moduleWebsite: analysis.moduleWebsite || "jasp-stats.org",
        },
        hasReport: false,
        id: analysisResourceId(analysis, index),
        isReport: false,
        name: analysis.name,
        options: analysis.options || {},
        plotEdits: null,
        progress: null,
        rSources: {},
        results,
        rfile: "",
        saveState: "default",
        status: complete ? "complete" : "notStarted",
        title: analysis.title || analysis.name,
        titleDef: analysis.title || analysis.name,
        userdata: null,
      };
    }),
    autoSaveDescription: null,
    autoSaveFileName: null,
    meta: null,
  };
}

const INDEX_HTML = [
  "<!DOCTYPE HTML>",
  "<html>",
  "\t<head>",
  "\t\t<meta http-equiv='Content-Type' content='text/html; charset=utf-8' />",
  "\t\t<title>JASP</title>",
  "\t\t<style>\t\t\tp {margin-top:1em; margin-bottom:1em; }\t\t\tbody {font-family: sans-serif; }</style>\t</head>",
  "\t<body style=\"display: block; padding: 0px; margin: 0px;\">",
  "<div style=\"display:inline-block\"><div >",
  "<div style=\"display:inline-block;\">",
  "<div  ><h1 >Results</h1></div></div></div></div>\t</body>",
  "</html>",
].join("\n");

function addAnalysisResources(files, analysis, index) {
  const id = analysisResourceId(analysis, index);
  const internal = hasEntries(analysis.jaspResults) ? analysis.jaspResults : null;
  const extras = Array.isArray(analysis.resources) ? analysis.resources : [];
  if (!internal && extras.length === 0) return;

  if (internal) {
    files.push({
      name: `resources/${id}/jaspResults.json`,
      data: `${JSON.stringify(internal, null, 3)}\n`,
    });
    files.push({
      name: `resources/${id}/jaspResultsFinishedWriting.txt`,
      data: JASP_RESULTS_SEAL,
    });
  }

  for (const resource of extras) {
    if (!resource?.name) continue;
    const relative = String(resource.name).replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relative || relative.includes("..")) continue;
    const base = relative.split("/").pop();
    if (base === "jaspResults.json" || base === "jaspResultsFinishedWriting.txt") continue;
    files.push({
      name: `resources/${id}/${relative}`,
      data: resource.data,
    });
  }
}

/**
 * @param {{columns: {name: string, type: string, labels?: string[], description?: string}[],
 *          rows: (number|string|null)[][],
 *          analyses?: {name: string, module: string, options: object, title?: string, columns?: string[], results?: object, jaspResults?: object, resources?: {name: string, data: Buffer|string}[], id?: number}[],
 *          description?: string}} input
 * @returns {Buffer} zip archive
 */
export function buildJaspArchive({ columns, rows, analyses = [], description = "" }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-write-"));
  const dbPath = path.join(work, "internal.sqlite");
  try {
    writeDatabase(dbPath, { columns, rows, description });

    const files = [
      { name: "analyses.json", data: `${JSON.stringify(buildAnalysesJson(analyses), null, 3)}\n` },
      {
        name: "manifest.json",
        data: `${JSON.stringify({ jaspArchiveVersion: ARCHIVE_VERSION, jaspVersion: JASP_VERSION }, null, 3)}\n`,
      },
      { name: "index.html", data: INDEX_HTML },
      { name: "internal.sqlite", data: fs.readFileSync(dbPath) },
    ];

    analyses.forEach((analysis, index) => addAnalysisResources(files, analysis, index));

    return createZip(files);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
