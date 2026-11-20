#!/usr/bin/env node
/**
 * LA CONQUISTA — EJECUTOR DE BENCHMARK EN NAVEGADOR REAL (Playwright + Canvas 2D)
 *
 * Uso:
 *   node scripts/runMapBrowserBenchmark.mjs [--url http://localhost:3000/?benchmark=map] [--out benchmark-browser.json]
 *
 * Requisitos:
 * - Playwright instalado (`npm i -D playwright && npx playwright install chromium`) en un entorno con navegador real.
 * - Si Playwright no está disponible en el entorno (ej. sandbox sin binarios de navegador),
 *   termina con código 2 informando exactamente la limitación sin inventar resultados.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const targetUrl = getArg("--url", "http://localhost:3000/?benchmark=map");
const outPath = getArg("--out", "");
const warmupMs = Number(getArg("--warmup", "2000"));
const measureMs = Number(getArg("--measure", "10000"));
const repetitions = Number(getArg("--reps", "3"));

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error(
    JSON.stringify(
      {
        status: "ENVIRONMENT_UNSUPPORTED",
        reason:
          "Playwright no está instalado ni existe un binario de navegador real (Chromium/Chrome/Firefox) en este entorno.",
        howToRun:
          "En una máquina o CI con navegador real: 1) npm run dev (o vite preview --port 3000), 2) npx playwright install chromium, 3) node scripts/runMapBrowserBenchmark.mjs --url http://localhost:3000/?benchmark=map --out benchmark-browser.json",
        host: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          cpus: os.cpus().length,
        },
      },
      null,
      2
    )
  );
  process.exit(2);
}

const browser = await playwright.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.__runMapBenchmarkSuite === "function", { timeout: 15_000 });

  const report = await page.evaluate(
    (opts) => window.__runMapBenchmarkSuite(opts),
    { warmupMs, measureMs, repetitions }
  );

  const enriched = {
    ...report,
    runner: {
      browserName: "chromium",
      browserVersion: browser.version(),
      osPlatform: process.platform,
      osRelease: os.release(),
      nodeVersion: process.version,
    },
  };

  const json = JSON.stringify(enriched, null, 2);
  if (outPath) {
    fs.writeFileSync(path.resolve(outPath), json, "utf8");
    console.log(`Benchmark real guardado en: ${path.resolve(outPath)}`);
  } else {
    console.log(json);
  }
} finally {
  await browser.close();
}
