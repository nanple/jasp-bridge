import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { exportTablesToCsv } from "../src/export/csv.js";

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
