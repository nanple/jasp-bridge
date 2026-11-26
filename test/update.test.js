import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  compareVersions,
  fetchManifest,
  validateManifest,
} from "../src/update/checker.js";

const VALID = {
  version: "0.2.0",
  url: "https://example.com/jasp-bridge-0.2.0.zip",
  sha256: "a".repeat(64),
  notes: "test release",
  runtime_required: false,
};

test("update: 版本比较", () => {
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.2.1"), -1);
  assert.equal(compareVersions("v0.2.0", "0.2.0"), 0);
});

test("update: 清单校验", () => {
  const manifest = validateManifest(VALID);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.sha256, "a".repeat(64));

  assert.throws(() => validateManifest({ ...VALID, version: "0.2" }), /version/);
  assert.throws(() => validateManifest({ ...VALID, sha256: "abc" }), /sha256/);
  assert.throws(
    () => validateManifest({ ...VALID, url: "http://example.com/a.zip" }),
    /https/
  );
  assert.doesNotThrow(() =>
    validateManifest({ ...VALID, url: "http://127.0.0.1:1234/latest.json" })
  );
});

test("update: 本地 HTTP 读取清单", async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(VALID));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const manifest = await fetchManifest(`http://127.0.0.1:${port}/latest.json`);
    assert.equal(manifest.version, "0.2.0");
    assert.equal(manifest.notes, "test release");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
