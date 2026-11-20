#!/usr/bin/env node
/**
 * LA CONQUISTA — EJECUTOR DE BENCHMARK REAL EN NAVEGADOR (Playwright + Canvas 2D)
 *
 * Uso:
 *   npm run benchmark:map -- [--url http://localhost:3000/?benchmark=map] [--out benchmark-browser.json]
 *   [--warmup 2000] [--measure 10000] [--reps 3] [--no-server]
 *
 * Garantías (Bloque C):
 * - Comprueba explícitamente si Chromium de Playwright está instalado; si no existe, sale con código 2 sin fabricar métricas.
 * - Arranca automáticamente un servidor local Vite si `--url` no responde y no se pasa `--no-server`.
 * - Crea contextos Playwright REALES separados por perfil:
 *   * Escritorio: viewport 1440×900, deviceScaleFactor 2, isMobile false, hasTouch false
 *   * Móvil:      viewport 390×844,  deviceScaleFactor 3, isMobile true,  hasTouch true
 * - Ejecuta todos los escenarios obligatorios, guarda el JSON y sale con código distinto de cero si falla alguno.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const targetUrl = getArg("--url", "http://127.0.0.1:4173/?benchmark=map");
const outPath = getArg("--out", "benchmark-browser.json");
const warmupMs = Number(getArg("--warmup", "2000"));
const measureMs = Number(getArg("--measure", "10000"));
const repetitions = Number(getArg("--reps", "3"));
const noAutoServer = hasFlag("--no-server");

function failUnsupported(reason) {
  console.error(
    JSON.stringify(
      {
        status: "ENVIRONMENT_UNSUPPORTED",
        reason,
        howToRun:
          "En una máquina o CI con navegador real: 1) npm ci, 2) npx playwright install chromium, 3) npm run build && npm run benchmark:map -- --out benchmark-browser.json",
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

let playwright;
try {
  playwright = await import("playwright");
} catch {
  failUnsupported("La dependencia 'playwright' no está instalada en node_modules.");
}

const chromiumPath = playwright.chromium.executablePath();
if (!chromiumPath || !fs.existsSync(chromiumPath)) {
  failUnsupported(
    `Playwright está instalado, pero el binario de Chromium no existe en "${chromiumPath || "(vacío)"}". Ejecuta 'npx playwright install chromium'.`
  );
}

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

let spawnedServer = null;
async function ensureLocalServer(url) {
  if (await isReachable(url)) return;
  if (noAutoServer) {
    throw new Error(`La URL ${url} no responde y se especificó --no-server.`);
  }
  const parsed = new URL(url);
  const port = parsed.port || "4173";
  const host = parsed.hostname || "127.0.0.1";
  const distExists = fs.existsSync(path.resolve("dist", "index.html"));
  const viteArgs = distExists
    ? ["vite", "preview", "--host", host, "--port", String(port), "--strictPort"]
    : ["vite", "--host", host, "--port", String(port), "--strictPort"];

  spawnedServer = spawn("npx", viteArgs, {
    stdio: "ignore",
    env: { ...process.env },
  });

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`No se pudo arrancar el servidor local en ${url} dentro de 25 s.`);
}

let browser = null;
try {
  await ensureLocalServer(targetUrl);
  browser = await playwright.chromium.launch({ headless: true });

  // 1. Obtener el catálogo real de escenarios desde la página (contexto ligero inicial)
  const probeCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const probePage = await probeCtx.newPage();
  await probePage.goto(targetUrl, { waitUntil: "networkidle" });
  await probePage.waitForFunction(
    () => typeof window.__runMapBenchmarkSuite === "function" && Array.isArray(window.__mapBenchmarkScenarios),
    { timeout: 15_000 }
  );
  const allScenarios = await probePage.evaluate(() => window.__mapBenchmarkScenarios);
  await probeCtx.close();

  const desktopIds = allScenarios.filter((s) => s.profile === "desktop").map((s) => s.id);
  const mobileIds = allScenarios.filter((s) => s.profile === "mobile").map((s) => s.id);

  const runProfileGroup = async (profile, scenarioIds) => {
    if (scenarioIds.length === 0) return null;
    const contextOptions =
      profile === "mobile"
        ? {
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
          }
        : {
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 2,
            isMobile: false,
            hasTouch: false,
          };

    const context = await browser.newContext(contextOptions);
    try {
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(() => typeof window.__runMapBenchmarkSuite === "function", { timeout: 15_000 });
      return await page.evaluate(
        (opts) => window.__runMapBenchmarkSuite(opts),
        { warmupMs, measureMs, repetitions, scenarioIds }
      );
    } finally {
      await context.close();
    }
  };

  const desktopReport = await runProfileGroup("desktop", desktopIds);
  const mobileReport = await runProfileGroup("mobile", mobileIds);

  const combinedScenarios = [
    ...(desktopReport?.scenarios ?? []),
    ...(mobileReport?.scenarios ?? []),
  ];

  // Verificar que todos los escenarios obligatorios se ejecutaron y produjeron frames reales
  if (combinedScenarios.length !== allScenarios.length) {
    throw new Error(
      `Escenarios incompletos: esperados ${allScenarios.length}, ejecutados ${combinedScenarios.length}.`
    );
  }
  for (const entry of combinedScenarios) {
    if (!entry.runs || entry.runs.length !== repetitions) {
      throw new Error(`Escenario ${entry.scenario.id} no completó las ${repetitions} repeticiones.`);
    }
    for (const run of entry.runs) {
      if (run.totalFrames <= 0) {
        throw new Error(`Escenario ${entry.scenario.id} repetición ${run.runIndex} registró 0 frames.`);
      }
      if (
        run.actualViewport.innerWidth !== entry.scenario.viewport.width ||
        run.actualViewport.innerHeight !== entry.scenario.viewport.height
      ) {
        throw new Error(
          `Emulación inconsistente en ${entry.scenario.id}: esperado ${entry.scenario.viewport.width}x${entry.scenario.viewport.height}, ` +
            `observado ${run.actualViewport.innerWidth}x${run.actualViewport.innerHeight}.`
        );
      }
    }
  }

  const baseEnv = desktopReport?.environment ?? mobileReport?.environment ?? null;
  const finalReport = {
    percentileMethod: "linear_interpolation_sorted_R7",
    warmupMs,
    measureMs,
    repetitions,
    environment: baseEnv,
    contexts: {
      desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
      mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    runner: {
      browserName: "chromium",
      browserVersion: browser.version(),
      chromiumExecutable: chromiumPath,
      osPlatform: process.platform,
      osRelease: os.release(),
      nodeVersion: process.version,
    },
    scenarios: combinedScenarios,
  };

  const json = JSON.stringify(finalReport, null, 2);
  if (outPath) {
    const resolvedOut = path.resolve(outPath);
    fs.writeFileSync(resolvedOut, json, "utf8");
    console.log(`Benchmark real guardado en: ${resolvedOut}`);
  } else {
    console.log(json);
  }
} catch (err) {
  console.error("ERROR en benchmark Playwright:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (spawnedServer) spawnedServer.kill("SIGTERM");
}
