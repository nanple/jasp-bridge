import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";

import {
  decodeEncodedNames,
  decodeEncodedString,
  columnDisplayTitle,
  normalizeEncodingMap,
} from "../src/export/decodeNames.js";
import { buildJaspFile, collectJaspRunArtifacts } from "../src/export/jaspExport.js";
import { buildJaspDatabase } from "../src/export/jaspWriter.js";

const MAP = [
  { original: "bdi", encoded: "jaspColumn1" },
  { original: "gender", encoded: "jaspColumn2" },
  { original: "medicine", encoded: "jaspColumn3" },
];

const MAP10 = [
  { original: "item1", encoded: "jaspColumn1" },
  { original: "item10", encoded: "jaspColumn10" },
];

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

test("decodeNames: 最长编码优先，jaspColumn10 不会被写成 jaspColumn1", () => {
  const mapping = normalizeEncodingMap(MAP10);
  assert.equal(decodeEncodedString("ANOVA - jaspColumn10", mapping), "ANOVA - item10");
  assert.equal(decodeEncodedString("ANOVA - jaspColumn1", mapping), "ANOVA - item1");
  assert.equal(
    decodeEncodedString("jaspColumn1 ✻ jaspColumn10", mapping),
    "item1 ✻ item10"
  );
});

test("decodeNames: 不会把 jaspColumn21 误当成 jaspColumn2", () => {
  const mapping = normalizeEncodingMap(MAP);
  const id = "anovaContainer_postHocStandardContainer_jaspColumn21";
  assert.equal(decodeEncodedString(id, mapping), id);
  assert.equal(decodeEncodedString("Post Hoc Comparisons - jaspColumn2", mapping), "Post Hoc Comparisons - gender");
  assert.equal(decodeEncodedString("jaspColumn2.", mapping), "gender.");
  assert.equal(decodeEncodedString("jaspColumn2 ✻ jaspColumn3", mapping), "gender ✻ medicine");
});

test("decodeNames: 递归还原对象值与表头键", () => {
  const decoded = decodeEncodedNames(
    {
      title: "ANOVA - jaspColumn1",
      data: [{ cases: "jaspColumn2" }, { cases: "jaspColumn2 ✻ jaspColumn3" }],
      schema: { fields: [{ name: "jaspColumn2.", title: "jaspColumn2" }] },
    },
    MAP
  );
  assert.equal(decoded.title, "ANOVA - bdi");
  assert.equal(decoded.data[0].cases, "gender");
  assert.equal(decoded.data[1].cases, "gender ✻ medicine");
  assert.equal(decoded.schema.fields[0].name, "gender.");
  assert.equal(decoded.schema.fields[0].title, "gender");
});

test("decodeNames: 列标题忽略其实是值编码的伪变量标签", () => {
  assert.equal(columnDisplayTitle({ name: "gender", label: "0", valueLabels: { "0": "Male", "1": "Female" } }), "gender");
  assert.equal(columnDisplayTitle({ name: "gender", label: "性别", valueLabels: { "0": "Male", "1": "Female" } }), "性别");
  assert.equal(columnDisplayTitle({ name: "bdi", label: "Score on Beck's Depression Inventory" }), "Score on Beck's Depression Inventory");
  assert.equal(columnDisplayTitle({ name: "id", label: "id" }), "id");
});

test("jasp 数据库：写入变量标题与 SPSS 值标签", () => {
  const dbBytes = buildJaspDatabase({
    columns: [
      {
        name: "gender",
        title: "性别",
        type: "nominal",
        description: "性别",
        valueLabels: { 0: "男", 1: "女" },
      },
      { name: "bdi", title: "抑郁量表得分", type: "scale", description: "抑郁量表得分" },
    ],
    rows: [
      ["0", 21],
      ["1", 30],
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-labels-"));
  const dbPath = path.join(dir, "internal.sqlite");
  fs.writeFileSync(dbPath, dbBytes);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const columns = db
    .prepare("SELECT name, title, description, columnType FROM Columns ORDER BY colIdx")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(columns, [
    { name: "gender", title: "性别", description: "性别", columnType: "nominal" },
    { name: "bdi", title: "抑郁量表得分", description: "抑郁量表得分", columnType: "scale" },
  ]);
  const labels = db
    .prepare("SELECT label, originalValueJson FROM Labels ORDER BY ordering")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(
    labels.map((row) => row.label),
    ["男", "女"]
  );
  assert.equal(String(labels[0].originalValueJson).trim(), "0");
  assert.equal(String(labels[1].originalValueJson).trim(), "1");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("导出的 .jasp 结果表使用原始变量名，并保留值标签", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-bridge-export-"));
  const dataPath = path.join(dir, "data.csv");
  fs.writeFileSync(dataPath, "gender,medicine,bdi\n0,1,21\n1,2,30\n", "utf8");
  const session = {
    data: {
      n: 2,
      variables: [
        { name: "gender", label: "0", type: "nominal", valueLabels: { 0: "Male", 1: "Female" } },
        { name: "medicine", label: "Medicine administered", type: "nominal", valueLabels: { 1: "None", 2: "Placebo" } },
        { name: "bdi", label: "Score on Beck's Depression Inventory", type: "scale" },
      ],
    },
  };
  const viewer = {
    name: "Anova",
    anovaTable: {
      title: "ANOVA - jaspColumn1",
      data: [
        { cases: "jaspColumn2" },
        { cases: "jaspColumn3" },
        { cases: "jaspColumn2 ✻ jaspColumn3" },
      ],
    },
    postHoc: {
      name: "anovaContainer_postHocStandardContainer_jaspColumn21",
      title: "Post Hoc Comparisons - jaspColumn2",
    },
  };
  const internal = {
    type: "results",
    title: "ANOVA - jaspColumn1",
    options: { dependent: "jaspColumn1" },
  };
  const result = {
    encoding_map: MAP,
    jasp_results_json: JSON.stringify(viewer),
    jasp_internal_json: JSON.stringify(internal),
  };
  const artifacts = collectJaspRunArtifacts(result, null);
  assert.equal(artifacts.results.anovaTable.title, "ANOVA - bdi");
  assert.equal(artifacts.results.anovaTable.data[0].cases, "gender");
  assert.equal(artifacts.results.anovaTable.data[2].cases, "gender ✻ medicine");
  assert.equal(artifacts.results.postHoc.name, "anovaContainer_postHocStandardContainer_jaspColumn21");
  assert.equal(artifacts.results.postHoc.title, "Post Hoc Comparisons - gender");
  assert.equal(artifacts.jaspResults.title, "ANOVA - bdi");
  assert.equal(artifacts.jaspResults.options.dependent, "bdi");

  const buffer = buildJaspFile({
    session,
    plan: { label: "单因素方差分析" },
    request: {
      name: "Anova",
      module: "jaspAnova",
      options: { dependent: "bdi", fixedFactors: ["gender", "medicine"] },
    },
    dataPath,
    results: artifacts.results,
    jaspResults: artifacts.jaspResults,
  });
  const files = unzip(buffer);
  const analyses = JSON.parse(files["analyses.json"].toString("utf8"));
  const packed = JSON.stringify(analyses);
  assert.equal((packed.match(/jaspColumn1(?!\d)/) || []).length, 0);
  assert.equal((packed.match(/jaspColumn2(?!\d)/) || []).length, 0);
  assert.equal((packed.match(/jaspColumn3(?!\d)/) || []).length, 0);
  assert.ok(packed.includes("anovaContainer_postHocStandardContainer_jaspColumn21"));
  assert.equal(analyses.analyses[0].results.anovaTable.title, "ANOVA - bdi");
  const stored = JSON.parse(files["resources/0/jaspResults.json"].toString("utf8"));
  assert.equal(stored.title, "ANOVA - bdi");
  assert.equal(stored.options.dependent, "bdi");

  const dbPath = path.join(dir, "internal.sqlite");
  fs.writeFileSync(dbPath, files["internal.sqlite"]);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const columns = db
    .prepare("SELECT name, title, description FROM Columns ORDER BY colIdx")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(
    columns.map((row) => row.name),
    ["gender", "medicine", "bdi"]
  );
  assert.equal(columns[0].title, "gender");
  assert.equal(columns[0].description, "");
  assert.equal(columns[1].title, "Medicine administered");
  assert.equal(columns[2].title, "Score on Beck's Depression Inventory");
  const genderLabels = db
    .prepare(
      "SELECT label FROM Labels WHERE columnId = (SELECT id FROM Columns WHERE name = 'gender') ORDER BY ordering"
    )
    .all()
    .map((row) => row.label);
  assert.deepEqual(genderLabels, ["Male", "Female"]);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
