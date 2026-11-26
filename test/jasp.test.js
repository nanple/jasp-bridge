import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildJaspArchive, buildJaspDatabase } from "../src/export/jaspWriter.js";
import { toJaspOptions } from "../src/export/jaspOptions.js";

const types = new Map([
  ["perf", "scale"],
  ["edu", "nominal"],
  ["gender", "nominal"],
]);

test("jasp 选项转换：变量选项包成 types/value 壳", () => {
  const options = toJaspOptions(
    {
      dependent: "perf",
      "dependent.types": "scale",
      fixedFactors: ["edu"],
      "fixedFactors.types": ["nominal"],
      barPlot: false,
    },
    types
  );
  assert.deepEqual(options.dependent, { types: ["scale"], value: "perf" });
  assert.deepEqual(options.fixedFactors, { types: ["nominal"], value: ["edu"] });
  assert.equal(options.barPlot, false);
  assert.equal(options["dependent.types"], undefined);
});

test("jasp 选项转换：模型项与事后比较用 optionKey 壳", () => {
  const options = toJaspOptions(
    {
      modelTerms: [{ components: ["edu"] }],
      postHocTerms: [{ components: ["edu"] }],
      contrasts: [{ variable: "edu", contrast: "Helmert" }],
    },
    types
  );
  assert.equal(options.modelTerms.optionKey, "components");
  assert.deepEqual(options.modelTerms.value, [{ components: ["edu"] }]);
  assert.deepEqual(options.modelTerms.types, ["nominal"]);
  assert.equal(options.postHocTerms.optionKey, "variable");
  assert.deepEqual(options.postHocTerms.value, [{ variable: ["edu"] }]);
  assert.deepEqual(options.contrasts.value, [{ variable: ["edu"], contrast: "Helmert" }]);
});

test("jasp 选项转换：.meta 标出需要编码的选项", () => {
  const options = toJaspOptions(
    {
      dependent: "perf",
      "dependent.types": "scale",
      modelTerms: [{ components: ["edu"] }],
    },
    types
  );
  assert.deepEqual(options[".meta"], {
    dependent: { shouldEncode: true },
    modelTerms: { shouldEncode: true },
  });
});

test("jasp 归档：包含 analyses.json / manifest.json / internal.sqlite", () => {
  const buffer = buildJaspArchive({
    columns: [
      { name: "edu", type: "nominal" },
      { name: "perf", type: "scale" },
    ],
    rows: [
      ["本科", 90],
      ["硕士", 91],
      ["博士", 92],
    ],
    analyses: [
      {
        name: "Anova",
        module: "jaspAnova",
        title: "方差分析",
        options: { dependent: { types: ["scale"], value: "perf" } },
      },
    ],
  });
  assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  const text = buffer.toString("latin1");
  assert.ok(text.includes("analyses.json"));
  assert.ok(text.includes("manifest.json"));
  assert.ok(text.includes("internal.sqlite"));
});

test("jasp 数据库：列、标签与数据行都写进去了", () => {
  const dbBytes = buildJaspDatabase({
    columns: [
      { name: "edu", type: "nominal" },
      { name: "perf", type: "scale" },
    ],
    rows: [
      ["本科", 90],
      ["硕士", 91],
      ["博士", 92],
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-test-"));
  const dbPath = path.join(dir, "internal.sqlite");
  fs.writeFileSync(dbPath, dbBytes);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const columns = db
    .prepare("SELECT name, columnType, hasLabels FROM Columns ORDER BY colIdx")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(columns, [
    { name: "edu", columnType: "nominal", hasLabels: 1 },
    { name: "perf", columnType: "scale", hasLabels: 0 },
  ]);

  const labels = db
    .prepare("SELECT value, label FROM Labels ORDER BY ordering")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(labels, [
    { value: 1, label: "本科" },
    { value: 2, label: "硕士" },
    { value: 3, label: "博士" },
  ]);

  const rows = db
    .prepare("SELECT rowNumber, Column_1, Column_2 FROM DataSet_1 ORDER BY rowNumber")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { rowNumber: 1, Column_1: 1, Column_2: 90 },
    { rowNumber: 2, Column_1: 2, Column_2: 91 },
    { rowNumber: 3, Column_1: 3, Column_2: 92 },
  ]);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

import zlib from "node:zlib";
import { JASP_RESULTS_SEAL } from "../src/export/jaspWriter.js";

function unzip(buffer) {
  const files = {};
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const payload = buffer.subarray(start, start + compSize);
    files[name] = method === 8 ? zlib.inflateRawSync(payload) : Buffer.from(payload);
    offset = start + compSize;
  }
  return files;
}

const sampleColumns = [
  { name: "edu", type: "nominal" },
  { name: "perf", type: "scale" },
];
const sampleRows = [
  ["本科", 90],
  ["硕士", 91],
  ["博士", 92],
];

test("jasp 归档：写入 resources/0/jaspResults 与完成标记", () => {
  const viewer = {
    ".meta": [{ name: "anovaTable", type: "table", title: "ANOVA", info: "" }],
    citation: ["JASP Team"],
    name: "Anova",
    anovaTable: {
      title: "ANOVA",
      name: "anovaTable",
      status: "complete",
      schema: { fields: [] },
      data: [{ cases: "edu", F: 1.2 }],
    },
  };
  const internal = {
    type: "results",
    title: "ANOVA",
    name: "",
    data: { anovaContainer: { type: "container", name: "anovaContainer", data: {} } },
    data_order: { anovaContainer: 1 },
    options: { dependent: "perf" },
    optionMustBe: {},
    relativePathKeep: "resources/0/state",
  };
  const buffer = buildJaspArchive({
    columns: sampleColumns,
    rows: sampleRows,
    analyses: [
      {
        name: "Anova",
        module: "jaspAnova",
        title: "方差分析",
        options: { dependent: { types: ["scale"], value: "perf" } },
        results: viewer,
        jaspResults: internal,
        resources: [{ name: "plot.png", data: Buffer.from("png") }],
      },
    ],
  });
  const files = unzip(buffer);
  const analyses = JSON.parse(files["analyses.json"].toString("utf8"));
  assert.equal(analyses.analyses[0].id, 0);
  assert.equal(analyses.analyses[0].status, "complete");
  assert.deepEqual(analyses.analyses[0].results, viewer);
  assert.ok(files["resources/0/jaspResults.json"]);
  assert.equal(files["resources/1/jaspResults.json"], undefined);
  const stored = JSON.parse(files["resources/0/jaspResults.json"].toString("utf8"));
  assert.equal(stored.type, "results");
  assert.deepEqual(stored.data_order, internal.data_order);
  assert.equal(stored[".meta"], undefined);
  assert.equal(files["resources/0/jaspResultsFinishedWriting.txt"].toString("utf8"), JASP_RESULTS_SEAL);
  assert.equal(files["resources/0/plot.png"].toString(), "png");
});

test("jasp 归档：只有查看器 results 时不把同一对象写成 jaspResults.json", () => {
  const viewer = { ".meta": [], name: "Anova", citation: [] };
  const buffer = buildJaspArchive({
    columns: sampleColumns,
    rows: sampleRows,
    analyses: [
      {
        name: "Anova",
        module: "jaspAnova",
        title: "方差分析",
        options: { dependent: { types: ["scale"], value: "perf" } },
        results: viewer,
      },
    ],
  });
  const files = unzip(buffer);
  const analyses = JSON.parse(files["analyses.json"].toString("utf8"));
  assert.equal(analyses.analyses[0].status, "complete");
  assert.deepEqual(analyses.analyses[0].results, viewer);
  assert.equal(files["resources/0/jaspResults.json"], undefined);
  assert.equal(files["resources/0/jaspResultsFinishedWriting.txt"], undefined);
});
