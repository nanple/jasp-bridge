import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { HOME_DIR, PLUGIN_VERSION, ensureDir } from "../config.js";

export function parseVersion(version) {
  const text = String(version ?? "").trim();
  const match = text.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`无法比较版本号：${left} / ${right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function isAllowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  );
}

export function validateManifest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("更新清单不是 JSON 对象。");
  }

  const version = String(value.version ?? "").trim();
  if (!parseVersion(version)) {
    throw new Error("更新清单缺少合法的 version（例如 0.2.0）。");
  }

  const url = String(value.url ?? "").trim();
  if (!isAllowedUrl(url)) {
    throw new Error("更新清单的 url 必须是 https，或本机 http://localhost / 127.0.0.1。");
  }

  const sha256 = String(value.sha256 ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("更新清单的 sha256 必须是 64 位十六进制字符串。");
  }

  const minPluginVersion = value.min_plugin_version
    ? String(value.min_plugin_version)
    : null;
  if (minPluginVersion && !parseVersion(minPluginVersion)) {
    throw new Error("min_plugin_version 不是合法版本号。");
  }

  return {
    version,
    url,
    sha256,
    notes: typeof value.notes === "string" ? value.notes : "",
    runtime_required: Boolean(value.runtime_required),
    min_plugin_version: minPluginVersion,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": `jasp-bridge/${PLUGIN_VERSION}`,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchManifest(url, { timeoutMs = 15000 } = {}) {
  if (!isAllowedUrl(url)) {
    throw new Error("更新地址必须是 https，或本机 http://localhost / 127.0.0.1。");
  }

  const response = await fetchWithTimeout(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`读取更新清单失败：HTTP ${response.status}`);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error("更新清单不是合法 JSON。");
  }
  return validateManifest(json);
}

export async function downloadFile(url, destination, { timeoutMs = 180000 } = {}) {
  const response = await fetchWithTimeout(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`下载更新包失败：HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("下载到的更新包为空。");
  if (buffer.length > 200 * 1024 * 1024) {
    throw new Error("更新包超过 200 MB，已拒绝下载。");
  }

  ensureDir(path.dirname(destination));
  fs.writeFileSync(destination, buffer);
  return { path: destination, bytes: buffer.length };
}

export function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function findPackageRoot(directory) {
  const direct = path.join(directory, "src", "server.js");
  if (fs.existsSync(direct)) return directory;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (fs.existsSync(path.join(candidate, "src", "server.js"))) return candidate;
  }
  return null;
}

export function extractZip(zipPath, destination) {
  ensureDir(destination);

  const tar = spawnSync("tar", ["-xf", zipPath, "-C", destination], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
  });
  if (tar.status === 0) return;

  const escapedZip = zipPath.replace(/'/g, "''");
  const escapedDestination = destination.replace(/'/g, "''");
  const command = `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDestination}' -Force`;
  const powershell = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", timeout: 120000, windowsHide: true }
  );

  if (powershell.status !== 0) {
    throw new Error(
      `解压失败：${(powershell.stderr || tar.stderr || "tar/Expand-Archive 均失败").trim()}`
    );
  }
}

export async function downloadUpdate(manifest, { installDir = HOME_DIR } = {}) {
  const updateDir = ensureDir(path.join(installDir, "updates", manifest.version));
  const zipPath = path.join(updateDir, "package.zip");
  const extractedRoot = path.join(updateDir, "extracted");
  const packageRoot = path.join(updateDir, "package");

  fs.rmSync(extractedRoot, { recursive: true, force: true });
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  const downloaded = await downloadFile(manifest.url, zipPath);
  const actualSha = sha256File(zipPath);
  if (actualSha !== manifest.sha256) {
    fs.rmSync(zipPath, { force: true });
    throw new Error(
      `SHA256 校验失败：下载 ${actualSha}，清单 ${manifest.sha256}。已删除更新包。`
    );
  }

  ensureDir(extractedRoot);
  extractZip(zipPath, extractedRoot);

  const resolved = findPackageRoot(extractedRoot);
  if (!resolved) {
    throw new Error("更新包中没有找到 src/server.js。");
  }

  if (resolved !== packageRoot) {
    fs.renameSync(resolved, packageRoot);
  }

  return {
    version: manifest.version,
    zipPath,
    packageRoot,
    bytes: downloaded.bytes,
    sha256: actualSha,
  };
}

export function updateCommand(packageRoot, installDir = HOME_DIR) {
  const script = path.join(installDir, "update.ps1");
  const fallback = path.join(packageRoot, "update.ps1");
  const updateScript = fs.existsSync(script) ? script : fallback;
  return `powershell -ExecutionPolicy Bypass -File "${updateScript}" -PackageDir "${packageRoot}" -InstallDir "${installDir}"`;
}
