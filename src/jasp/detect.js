import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DETECT_TIMEOUT_MS, HOME_DIR, JASP_PATH, RSCRIPT } from "../config.js";

let cache = null;
let cacheAt = 0;

function exists(file) {
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function scanWindowsR() {
  const roots = [
    "C:\\Program Files\\R",
    "C:\\Program Files (x86)\\R",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "R"),
  ];
  const found = [];
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!/^R-\d/.test(entry)) continue;
      const candidate = path.join(root, entry, "bin", "Rscript.exe");
      if (exists(candidate)) found.push(candidate);
    }
  }
  return found.sort().reverse();
}

function findOnPath(name) {
  const pathValue = process.env.PATH || "";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function findAppxJasp() {
  if (process.platform !== "win32") return null;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-AppxPackage -Name '*JASP*' | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation",
    ],
    { encoding: "utf8", timeout: DETECT_TIMEOUT_MS, windowsHide: true }
  );
  const installLocation = String(result.stdout || "").trim();
  if (!installLocation || !fs.existsSync(installLocation)) return null;
  for (const name of ["JASPDesktop.exe", "JASP.exe"]) {
    const candidate = path.join(installLocation, name);
    if (exists(candidate)) {
      return { path: candidate, edition: "store", install_location: installLocation };
    }
  }
  return null;
}

export function findJaspInfo() {
  if (JASP_PATH && exists(JASP_PATH)) {
    return { path: JASP_PATH, edition: "custom", install_location: path.dirname(JASP_PATH) };
  }
  const candidates = [
    "C:\\Program Files\\JASP\\JASP.exe",
    "C:\\Program Files\\JASP\\JASPDesktop.exe",
    "C:\\Program Files (x86)\\JASP\\JASP.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "JASP", "JASP.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "JASP", "JASP.exe"),
    "/Applications/JASP.app/Contents/MacOS/JASP",
    "/usr/bin/jasp",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { path: candidate, edition: "desktop", install_location: path.dirname(candidate) };
    }
  }
  return findAppxJasp();
}

export function findJasp() {
  return findJaspInfo()?.path || null;
}

export function findRuntime() {
  const runtime = process.env.JASP_RUNTIME || path.join(HOME_DIR, "runtime");
  const candidates =
    process.platform === "win32"
      ? [path.join(runtime, "R", "bin", "Rscript.exe"), path.join(runtime, "R", "bin", "x64", "Rscript.exe")]
      : [path.join(runtime, "R", "bin", "Rscript")];
  const rscript = candidates.find((candidate) => exists(candidate));
  if (rscript && fs.existsSync(path.join(runtime, "lib"))) {
    return { path: runtime, rscript };
  }
  return null;
}

export function findRscript() {
  const runtime = findRuntime();
  if (runtime) return runtime.rscript;
  if (RSCRIPT && RSCRIPT !== "Rscript" && exists(RSCRIPT)) {
    return RSCRIPT;
  }
  const onPath = findOnPath("Rscript");
  if (onPath) return onPath;
  if (process.platform === "win32") {
    const scanned = scanWindowsR();
    if (scanned.length > 0) return scanned[0];
  }
  return null;
}

export function probeR(rscript = findRscript(), runtimePath = findRuntime()?.path) {
  if (!rscript) return { available: false, path: null, error: "未找到 Rscript" };

  if (runtimePath) {
    const probeScript = fileURLToPath(
      new URL("../../scripts/probe_runtime.R", import.meta.url)
    );
    const result = spawnSync(rscript, ["--vanilla", probeScript], {
      encoding: "utf8",
      timeout: DETECT_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, JASP_RUNTIME: runtimePath },
    });
    if (result.error || result.status !== 0) {
      return {
        available: false,
        path: rscript,
        runtime: runtimePath,
        error: (result.error?.message || result.stderr || "JASP 运行时探测失败").trim(),
      };
    }
    const line = String(result.stdout)
      .split(/\r?\n/)
      .find((item) => item.startsWith("R="));
    const match = line?.match(/^R=(.+)\|jaspTools=(.+)\|runtime=(.+)\|ok$/);
    if (!match) {
      return {
        available: false,
        path: rscript,
        runtime: runtimePath,
        error: String(result.stdout || result.stderr || "运行时探测输出无法解析").trim(),
      };
    }
    return {
      available: true,
      path: rscript,
      version: match[1],
      jaspTools: match[2],
      jaspToolsReady: true,
      runtime: match[3],
    };
  }

  const code =
    'cat(R.version.string); cat("|"); cat(tryCatch(as.character(packageVersion("jaspTools")), error=function(e) "missing"))';
  const result = spawnSync(rscript, ["--vanilla", "-e", code], {
    encoding: "utf8",
    timeout: DETECT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      path: rscript,
      error: (result.error?.message || result.stderr || "Rscript 启动失败").trim(),
    };
  }
  const [version, jaspTools] = String(result.stdout).trim().split("|");
  return {
    available: true,
    path: rscript,
    version: version || null,
    jaspTools: jaspTools || "missing",
    jaspToolsReady: Boolean(jaspTools && jaspTools !== "missing"),
  };
}

export function getCapabilities({ refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && cache && now - cacheAt < 60000) return cache;

  const jaspInfo = findJaspInfo();
  const runtime = findRuntime();
  const rscript = findRscript();
  const r = probeR(rscript, runtime?.path);
  const bundledR =
    jaspInfo?.edition === "store"
      ? path.join(jaspInfo.install_location, "R", "bin", "Rscript.exe")
      : null;

  cache = {
    node: process.version,
    platform: process.platform,
    jasp: {
      available: Boolean(jaspInfo),
      path: jaspInfo?.path || null,
      edition: jaspInfo?.edition || null,
      install_location: jaspInfo?.install_location || null,
      bundled_r: bundledR && exists(bundledR) ? bundledR : null,
    },
    runtime: runtime
      ? { path: runtime.path, rscript: runtime.rscript }
      : null,
    r,
    backends: {
      headless_r: Boolean(r.available && r.jaspToolsReady),
      cli_template: Boolean(jaspInfo),
      dry_run: true,
    },
    checked_at: new Date().toISOString(),
  };
  cacheAt = now;
  return cache;
}

export function capabilitiesMarkdown(caps) {
  const lines = [
    "### JASP-Bridge 环境自检",
    "",
    `- Node：${caps.node}（${caps.platform}）`,
    `- JASP：${
      caps.jasp.available
        ? `✅ ${caps.jasp.path}${caps.jasp.edition === "store" ? "（Store 版）" : ""}`
        : "❌ 未找到（可设置 JASP_PATH）"
    }`,
    `- Rscript：${caps.r.available ? `✅ ${caps.r.path}` : "❌ 未找到（可设置 RSCRIPT）"}`,
    caps.jasp.bundled_r
      ? `- JASP 自带 R：${caps.jasp.bundled_r}（Store 版 ACL 限制，通常无法直接执行）`
      : "",
    caps.runtime
      ? `- JASP 运行时：✅ ${caps.runtime.path}`
      : "- JASP 运行时：❌ 未配置（运行 scripts/setup_runtime.ps1）",
    `- jaspTools：${
      caps.r.jaspToolsReady ? `✅ ${caps.r.jaspTools}` : "❌ 未安装或 R 不可用"
    }`,
    "",
    "**可用后端**",
    `- 无头 R：${caps.backends.headless_r ? "✅" : "❌"}`,
    `- JASP CLI 报告模式：${caps.backends.cli_template ? "✅" : "❌"}`,
    `- 试运行（只生成请求，不出数）：✅`,
  ];
  if (caps.jasp.edition === "store" && !caps.backends.headless_r) {
    lines.push(
      "",
      "> 检测到 Microsoft Store 版 JASP。它自带的 R 位于 WindowsApps 目录，受 ACL 限制，不能直接作为 `Rscript` 使用；请先运行 `scripts/setup_runtime.ps1` 复制到用户目录，若复制失败再安装独立 R + jaspTools。"
    );
  }
  if (!caps.backends.headless_r) {
    lines.push(
      "",
      "> 无头 R 未就绪时，`jasp_run` 会进入 dry-run：生成 JASP 分析请求与 R 脚本，但不会产生统计结果。已有 `.jasp` 模板可用 `jasp_run_template` 导出报告。"
    );
  }
  return lines.join("\n");
}
