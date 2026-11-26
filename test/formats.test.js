import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as XLSX from "@e965/xlsx";
import { writeSav, ReadStatType, ReadStatMeasure } from "@irbisadm/statfmt";

import { ingestFile, ingestText, inferType, profileMarkdown } from "../src/data/ingest.js";
import { IngestUserError } from "../src/data/errors.js";

const ROWS = [
  { id: 1, gender: 1, age: 22, sat1: 4, sat2: 5, sat3: 4, sat4: 3, sat5: 4, sat_mean: 4.2, group: "实验组" },
  { id: 2, gender: 2, age: 24, sat1: 3, sat2: 4, sat3: 3, sat4: 4, sat5: 3, sat_mean: 3.4, group: "对照组" },
  { id: 3, gender: 1, age: 28, sat1: 5, sat2: 5, sat3: 4, sat4: 5, sat5: 4, sat_mean: 4.6, group: "实验组" },
  { id: 4, gender: 2, age: 21, sat1: 2, sat2: 3, sat3: 2, sat4: 3, sat5: 2, sat_mean: 2.4, group: "对照组" },
  { id: 5, gender: 1, age: 26, sat1: 4, sat2: 4, sat3: 5, sat4: 4, sat5: 5, sat_mean: 4.4, group: "实验组" },
  { id: 6, gender: 2, age: 30, sat1: 3, sat2: 2, sat3: 3, sat4: 2, sat5: 3, sat_mean: 2.6, group: "对照组" },
];

const DEMO_CSV = `id,gender,age,sat1,sat2,sat3,sat4,sat5,sat_mean,group
1,1,22,4,5,4,3,4,4.2,实验组
2,2,24,3,4,3,4,3,3.4,对照组
3,1,28,5,5,4,5,4,4.6,实验组
4,2,21,2,3,2,3,2,2.4,对照组
5,1,26,4,4,5,4,5,4.4,实验组
6,2,30,3,2,3,2,3,2.6,对照组
`;

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-formats-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeWorkbook(filePath, bookType, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  }
  const buf = XLSX.write(wb, { bookType, type: "buffer" });
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function writeLikertSav(filePath, rows = ROWS) {
  const bytes = writeSav({
    fileLabel: "synthetic likert",
    valueLabelSets: {
      gender: [
        { value: 1, label: "男" },
        { value: 2, label: "女" },
      ],
      likert: [
        { value: 1, label: "非常不同意" },
        { value: 2, label: "不同意" },
        { value: 3, label: "一般" },
        { value: 4, label: "同意" },
        { value: 5, label: "非常同意" },
      ],
    },
    variables: [
      { name: "id", type: ReadStatType.INT32, measure: ReadStatMeasure.NOMINAL, label: "被试编号" },
      { name: "gender", type: ReadStatType.INT32, measure: ReadStatMeasure.NOMINAL, label: "性别", valueLabels: "gender" },
      { name: "age", type: ReadStatType.INT32, measure: ReadStatMeasure.SCALE, label: "年龄" },
      { name: "sat1", type: ReadStatType.INT32, measure: ReadStatMeasure.ORDINAL, label: "满意度题项1", valueLabels: "likert" },
      { name: "sat2", type: ReadStatType.INT32, measure: ReadStatMeasure.ORDINAL, label: "满意度题项2", valueLabels: "likert" },
      { name: "sat3", type: ReadStatType.INT32, measure: ReadStatMeasure.ORDINAL, label: "满意度题项3", valueLabels: "likert" },
      { name: "sat4", type: ReadStatType.INT32, measure: ReadStatMeasure.ORDINAL, label: "满意度题项4", valueLabels: "likert" },
      { name: "sat5", type: ReadStatType.INT32, measure: ReadStatMeasure.ORDINAL, label: "满意度题项5", valueLabels: "likert" },
      { name: "sat_mean", type: ReadStatType.DOUBLE, measure: ReadStatMeasure.SCALE, label: "满意度均分" },
      { name: "group", type: ReadStatType.STRING, measure: ReadStatMeasure.NOMINAL, label: "组别", storageWidth: 20 },
    ],
    rows: rows.map((r) => [r.id, r.gender, r.age, r.sat1, r.sat2, r.sat3, r.sat4, r.sat5, r.sat_mean, r.group]),
  });
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function typeOf(data, name) {
  return data.variables.find((variable) => variable.name === name)?.type;
}

function variableOf(data, name) {
  return data.variables.find((variable) => variable.name === name);
}

function assertLikertTypes(data, { fromSav = false } = {}) {
  assert.equal(data.n, 6);
  assert.equal(typeOf(data, "id"), "nominal");
  assert.equal(typeOf(data, "gender"), "nominal");
  assert.equal(typeOf(data, "group"), "nominal");
  assert.equal(typeOf(data, "age"), "scale");
  assert.equal(typeOf(data, "sat1"), "ordinal");
  assert.equal(typeOf(data, "sat5"), "ordinal");
  assert.equal(typeOf(data, "sat_mean"), "scale");
  assert.equal(Number(data.preview[0].sat_mean), 4.2);
  assert.equal(data.preview[0].group, "实验组");
  if (fromSav) {
    assert.equal(variableOf(data, "gender").label, "性别");
    assert.equal(variableOf(data, "sat1").label, "满意度题项1");
    assert.equal(variableOf(data, "sat_mean").label, "满意度均分");
    assert.equal(variableOf(data, "gender").valueLabels["1"], "男");
    assert.equal(variableOf(data, "sat1").valueLabels["5"], "非常同意");
  }
}

test("xlsx: 读取 Likert 量表数据并走同一套类型推断", () => {
  withTempDir((dir) => {
    const file = writeWorkbook(path.join(dir, "likert.xlsx"), "xlsx", { 量表: ROWS });
    const data = ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" });
    assert.equal(data.format, "xlsx");
    assert.equal(data.sheet, "量表");
    assert.equal(data.engine, "node");
    assertLikertTypes(data);
    assert.ok(fs.existsSync(data.path));
    assert.match(fs.readFileSync(data.path, "utf8"), /sat_mean/);
  });
});

test("xls: 读取旧版 Excel 与 xlsx 得到相同的值与类型", () => {
  withTempDir((dir) => {
    const xlsxFile = writeWorkbook(path.join(dir, "likert.xlsx"), "xlsx", { 量表: ROWS });
    const xlsFile = writeWorkbook(path.join(dir, "likert.xls"), "xls", { 量表: ROWS });
    const fromXlsx = ingestFile(xlsxFile, { outDir: path.join(dir, "out-xlsx"), engine: "node" });
    const fromXls = ingestFile(xlsFile, { outDir: path.join(dir, "out-xls"), engine: "node" });
    assert.equal(fromXls.format, "xls");
    assertLikertTypes(fromXls);
    assert.deepEqual(fromXls.preview, fromXlsx.preview);
    assert.deepEqual(
      fromXls.variables.map((v) => [v.name, v.type]),
      fromXlsx.variables.map((v) => [v.name, v.type])
    );
  });
});

test("sav: 保留变量标签、值标签与 measure 类型", () => {
  withTempDir((dir) => {
    const file = writeLikertSav(path.join(dir, "likert.sav"));
    const data = ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" });
    assert.equal(data.format, "sav");
    assertLikertTypes(data, { fromSav: true });
    const markdown = profileMarkdown(data);
    assert.match(markdown, /sat1（满意度题项1）/);
    assert.match(markdown, /1=男\(3\)/);
    assert.match(markdown, /4=同意/);
  });
});

test("sav: 显式 types 仍优先于文件中的 measure", () => {
  withTempDir((dir) => {
    const file = writeLikertSav(path.join(dir, "likert.sav"));
    const data = ingestFile(file, {
      outDir: path.join(dir, "out"),
      engine: "node",
      types: { sat1: "scale" },
    });
    assert.equal(typeOf(data, "sat1"), "scale");
    assert.equal(typeOf(data, "sat2"), "ordinal");
  });
});

test("xlsx: 多工作表默认读第一张，可用表名或 1 起的序号指定", () => {
  withTempDir((dir) => {
    const file = writeWorkbook(path.join(dir, "multi.xlsx"), "xlsx", {
      量表: ROWS,
      说明: [{ note: "第二张表", n: 1 }],
    });
    const first = ingestFile(file, { outDir: path.join(dir, "out1"), engine: "node" });
    assert.equal(first.sheet, "量表");
    assert.equal(first.sheetIndex, 1);
    assert.deepEqual(first.sheets, ["量表", "说明"]);
    assert.equal(first.n, 6);

    const byName = ingestFile(file, { outDir: path.join(dir, "out2"), engine: "node", sheet: "说明" });
    assert.equal(byName.sheet, "说明");
    assert.equal(byName.n, 1);
    assert.equal(byName.preview[0].note, "第二张表");

    const byIndex = ingestFile(file, { outDir: path.join(dir, "out3"), engine: "node", sheet: 2 });
    assert.equal(byIndex.sheet, "说明");
    assert.equal(byIndex.sheetIndex, 2);
    assert.deepEqual(byIndex.preview, byName.preview);
  });
});

test("xlsx: 找不到工作表或序号非法时列出可用表", () => {
  withTempDir((dir) => {
    const file = writeWorkbook(path.join(dir, "multi.xlsx"), "xlsx", {
      量表: ROWS,
      说明: [{ note: "第二张表", n: 1 }],
    });
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node", sheet: "人口学" }),
      (error) =>
        error instanceof IngestUserError &&
        error.code === "sheet_not_found" &&
        /人口学/.test(error.message) &&
        /1\. 量表/.test(error.message) &&
        /2\. 说明/.test(error.message)
    );
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node", sheet: 0 }),
      (error) => error instanceof IngestUserError && /从 1 开始/.test(error.message)
    );
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node", sheet: 3 }),
      (error) => error instanceof IngestUserError && /没有第 3 张表/.test(error.message)
    );
  });
});

test("xlsx: 第一张表为空时提示可改读其他表", () => {
  withTempDir((dir) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["id", "note"]]), "空表");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ROWS), "量表");
    const file = path.join(dir, "empty-first.xlsx");
    fs.writeFileSync(file, XLSX.write(wb, { bookType: "xlsx", type: "buffer" }));
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" }),
      (error) =>
        error instanceof IngestUserError &&
        error.code === "empty" &&
        /空表/.test(error.message) &&
        /量表/.test(error.message) &&
        /sheet 参数/.test(error.message)
    );
  });
});

test("xlsx: 密码保护工作簿给出明确报错", () => {
  withTempDir((dir) => {
    const cfb = XLSX.CFB.utils.cfb_new();
    XLSX.CFB.utils.cfb_add(cfb, "EncryptionInfo", Buffer.from("x"));
    XLSX.CFB.utils.cfb_add(cfb, "EncryptedPackage", Buffer.from("y"));
    const file = path.join(dir, "secret.xlsx");
    fs.writeFileSync(file, XLSX.CFB.write(cfb, { type: "buffer" }));
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" }),
      (error) =>
        error instanceof IngestUserError &&
        error.code === "encrypted" &&
        /密码/.test(error.message)
    );
  });
});

test("损坏的 xlsx / xls / sav 给出明确报错", () => {
  withTempDir((dir) => {
    const xlsx = path.join(dir, "bad.xlsx");
    const xls = path.join(dir, "bad.xls");
    const sav = path.join(dir, "bad.sav");
    fs.writeFileSync(xlsx, "PK\x03\x04 this is not a workbook");
    fs.writeFileSync(xls, "this is not an excel workbook");
    fs.writeFileSync(sav, "this is not an spss file");
    for (const [file, ext] of [
      [xlsx, "xlsx"],
      [xls, "xls"],
      [sav, "sav"],
    ]) {
      assert.throws(
        () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" }),
        (error) =>
          error instanceof IngestUserError &&
          error.code === "corrupt" &&
          new RegExp(ext, "i").test(error.message) &&
          /损坏/.test(error.message)
      );
    }
  });
});

test("不支持把 .xlx 当作扩展名，并提示改为 .xls", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "old.xlx");
    fs.writeFileSync(file, "placeholder");
    assert.throws(
      () => ingestFile(file, { outDir: path.join(dir, "out"), engine: "node" }),
      (error) => error instanceof IngestUserError && /\.xls/.test(error.message)
    );
  });
});

test("CSV 读入行为保持不变", () => {
  withTempDir((dir) => {
    const file = path.join(dir, "likert.csv");
    fs.writeFileSync(file, DEMO_CSV, "utf8");
    const fromFile = ingestFile(file, { outDir: path.join(dir, "out-file") });
    const fromText = ingestText(DEMO_CSV, { outDir: path.join(dir, "out-text"), name: "likert" });
    assert.equal(fromFile.format, "csv");
    assertLikertTypes(fromFile);
    assert.deepEqual(
      fromFile.variables.map((v) => [v.name, v.type, v.missing, v.unique]),
      fromText.variables.map((v) => [v.name, v.type, v.missing, v.unique])
    );
    assert.equal(inferType("sat_mean", ["4.2", "3.4", "4.6"]), "scale");
  });
});
