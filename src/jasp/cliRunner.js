import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findJasp } from "./detect.js";

function readReportSummary(outputDir) {
  const resultsPath = path.join(outputDir, "dashboard", "results.json");
  if (!fs.existsSync(resultsPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    return {
      path: resultsPath,
      analyses: (json.analyses || []).map((analysis) => ({
        name: analysis.name,
        id: analysis.id,
        module: analysis.dynamicModule?.moduleName,
        module_version: analysis.dynamicModule?.moduleVersion,
      })),
    };
  } catch {
    return null;
  }
}

export function runTemplate({
  templatePath,
  dataDir,
  outputDir,
  timeoutMs = 600000,
  hide = false,
}) {
  return new Promise((resolve, reject) => {
    const jasp = findJasp();
    if (!jasp) {
      reject(
        new Error(
          "未找到 JASP 可执行文件。可设置 JASP_PATH，例如 C:\\Program Files\\JASP\\JASPDesktop.exe。"
        )
      );
      return;
    }
    if (!fs.existsSync(templatePath)) {
      reject(new Error(`模板不存在：${templatePath}`));
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const timeoutMinutes = Math.max(1, Math.ceil(timeoutMs / 60000));
    // JASP 0.99.x 的 CLI 支持 --report；--inputDataDir/--outputPdf 只存在于部分开发版。
    const args = [
      templatePath,
      "--report",
      outputDir,
      "--logToFile",
      `--timeOut=${timeoutMinutes}`,
    ];
    if (hide) args.push("--hide");

    const child = spawn(jasp, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let completedDetected = false;
    let settled = false;

    const completePath = path.join(outputDir, "report.complete");
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watcher);
      const outputFiles = fs.existsSync(outputDir)
        ? fs
            .readdirSync(outputDir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(outputDir, entry.name))
        : [];
      const reportPdf = path.join(outputDir, "report.pdf");
      const reportHtml = path.join(outputDir, "dashboard", "index.html");
      resolve({
        command: `"${jasp}" ${args.map((arg) => `"${arg}"`).join(" ")}`,
        exit_code: code,
        timed_out: timedOut && !completedDetected,
        stdout,
        stderr,
        output_files: outputFiles,
        report_pdf: fs.existsSync(reportPdf) ? reportPdf : null,
        report_html: fs.existsSync(reportHtml) ? reportHtml : null,
        completed: fs.existsSync(completePath),
        summary: readReportSummary(outputDir),
        data_dir_ignored: Boolean(dataDir),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);

    // JASP --report 生成 report.complete 后进程可能继续驻留，检测到完成标记就主动收尾。
    const watcher = setInterval(() => {
      if (fs.existsSync(completePath)) {
        completedDetected = true;
        clearInterval(watcher);
        setTimeout(() => {
          try {
            child.kill();
          } catch {
            // ignore
          }
        }, 1500);
      }
    }, 500);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      clearInterval(watcher);
      reject(error);
    });

    child.on("exit", (code) => {
      finish(code);
    });
  });
}
