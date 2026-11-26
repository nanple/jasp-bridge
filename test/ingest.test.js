import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { inferType, ingestText } from "../src/data/ingest.js";

test("inferType: 显式 types 覆盖优先于推断", () => {
  const values = ["1", "2", "3", "4", "5", "4", "3"];
  assert.equal(inferType("sat1", values, "scale"), "scale");
  assert.equal(inferType("sat_mean", ["3.2", "4.1", "3.8"], "ordinal"), "ordinal");
});

test("inferType: 带小数的量表均分即使唯一值很少也是 scale", () => {
  const values = ["3.25", "4.00", "3.50", "2.75", "4.00", "3.25", "3.50", "2.75"];
  assert.ok(new Set(values).size <= 10);
  assert.equal(inferType("sat_mean", values), "scale");
});

test("inferType: 写成 4.0 的连续分数也是 scale，不以唯一值数量单独判定", () => {
  const values = ["4.0", "3.0", "5.0", "4.0", "3.0", "5.0", "2.0"];
  assert.ok(new Set(values).size <= 10);
  assert.equal(inferType("total_score", values), "scale");
});

test("inferType: 1–5 李克特题项仍为 ordinal", () => {
  const values = ["1", "2", "3", "4", "5", "4", "3", "2", "1", "5"];
  assert.equal(inferType("sat1", values), "ordinal");
});

test("inferType: 1–7 题项在小样本只出现部分水平仍为 ordinal", () => {
  const values = ["3", "4", "5", "4", "3", "5", "4"];
  assert.equal(inferType("item2", values), "ordinal");
});

test("inferType: 取值很少的整数连续变量（如年龄、测验总分）是 scale", () => {
  const ages = ["28", "30", "32", "35", "38", "40", "45", "29"];
  const scores = ["78", "80", "85", "87", "88", "89", "90", "92"];
  assert.ok(new Set(ages).size <= 10);
  assert.ok(new Set(scores).size <= 10);
  assert.equal(inferType("age", ages), "scale");
  assert.equal(inferType("perf", scores), "scale");
});

test("inferType: 二分整数仍为 nominal，非数值为 nominal", () => {
  assert.equal(inferType("passed", ["0", "1", "0", "1", "1"]), "nominal");
  assert.equal(inferType("treat", ["1", "2", "1", "2", "1"]), "nominal");
  assert.equal(inferType("gender", ["男", "女", "男", "女"]), "nominal");
});

test("inferType: 1–5 题项在小样本只出现 4 和 5 时仍为 ordinal", () => {
  assert.equal(inferType("sat3", ["4", "5", "4", "4", "5", "4"]), "ordinal");
});

test("ingest: 同时把均分判为 scale、题项判为 ordinal", () => {
  const csv = `id,sat1,sat2,sat3,sat_mean,age
1,4,5,4,4.33,30
2,5,4,5,4.67,28
3,3,4,4,3.67,35
4,4,4,5,4.33,32
5,5,5,4,4.67,40
6,4,3,4,3.67,29
`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-ingest-type-"));
  try {
    const data = ingestText(csv, { outDir, name: "types" });
    const typeOf = (name) => data.variables.find((variable) => variable.name === name).type;
    assert.equal(typeOf("id"), "nominal");
    assert.equal(typeOf("sat1"), "ordinal");
    assert.equal(typeOf("sat2"), "ordinal");
    assert.equal(typeOf("sat3"), "ordinal");
    assert.equal(typeOf("sat_mean"), "scale");
    assert.equal(typeOf("age"), "scale");
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
