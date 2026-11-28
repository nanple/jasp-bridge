import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { exportTablesToCsv } from "../src/export/csv.js";
import { formatCell, mdTable } from "../src/format.js";
import { tablesToMarkdown } from "../src/jasp/parse.js";

test("csv: 导出结果表并带 UTF-8 BOM", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-csv-test-"));
  try {
    const files = exportTablesToCsv(
      {
        ttest: {
          title: "独立样本 t 检验",
          data: [
            { statistic: 2.1, p: 0.04, note: "支持, 显著" },
            { statistic: 2.0, p: 0.05, note: '含"引号"' },
          ],
        },
      },
      dir
    );

    assert.equal(files.length, 1);
    assert.equal(files[0].rows, 2);
    assert.equal(files[0].columns, 3);

    const content = fs.readFileSync(files[0].file, "utf8");
    assert.ok(content.startsWith("\uFEFF"));
    assert.match(content, /statistic,p,note/);
    assert.match(content, /"支持, 显著"/);
    assert.match(content, /"含""引号"""/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("formatCell: 把嵌套的描述统计单元格平铺成可读数值", () => {
  assert.equal(formatCell({ value: 12.5, type: "number", format: "dp:3" }), "12.5");
  assert.equal(formatCell({ value: 0.001, superscript: "*" }), "0.001*");
  assert.equal(formatCell({ min: 1.2, max: 9.8 }), "1.2–9.8");
  assert.match(formatCell({ "25th percentile": 2.1, "50th percentile": 3.4, "75th percentile": 5.6 }), /2\.1/);
  assert.equal(formatCell(530), "530");
  assert.equal(formatCell(null), "");
  assert.ok(!formatCell({ value: 7, type: "number" }).includes("[object Object]"));
});

test("描述统计 Markdown 和 CSV 不会把嵌套单元格写成 [object Object]", () => {
  const tables = {
    descriptives: {
      title: "描述统计",
      data: [
        {
          Variable: "rt",
          Mean: 525.4,
          Min: { value: 500, type: "number", format: "dp:3" },
          Max: { value: 670, type: "number" },
          Median: { value: 530 },
          "25th percentile": { value: 510 },
          "75th percentile": { value: 550 },
        },
      ],
    },
  };

  const markdown = tablesToMarkdown(tables);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /500/);
  assert.match(markdown, /670/);
  assert.match(markdown, /530/);
  assert.match(markdown, /510/);
  assert.match(markdown, /550/);
  assert.match(mdTable(["Min"], [[{ value: 500 }]]), /500/);
  assert.doesNotMatch(mdTable(["Min"], [[{ value: 500 }]]), /\[object Object\]/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jasp-csv-nested-"));
  try {
    const files = exportTablesToCsv(tables, dir);
    const content = fs.readFileSync(files[0].file, "utf8");
    assert.doesNotMatch(content, /\[object Object\]/);
    assert.match(content, /500/);
    assert.match(content, /670/);
    assert.match(content, /530/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
