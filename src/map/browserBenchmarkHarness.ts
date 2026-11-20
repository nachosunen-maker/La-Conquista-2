/**
 * LA CONQUISTA — HARNESS DE BENCHMARK REAL EN NAVEGADOR (Bloque 2, Puntos 3+4)
 *
 * Ejecuta el renderizador real `MedievalMapRenderer` sobre un `<canvas>` 2D real en navegador,
 * siguiendo el procedimiento estadístico obligatorio:
 * - Calentamiento >= 2.000 ms (excluido de muestras).
 * - Medición sostenida >= 10.000 ms por repetición.
 * - 3 repeticiones por escenario, conservando resultados individuales y mediana de las 3.
 * - Percentiles calculados sobre las muestras ordenadas (interpolación lineal R-7).
 * - Separación explícita entre frame time real de rAF (FPS observados), tiempo JS/Canvas,
 *   memoria de caché de stamps (`stampCacheBytes`) y heap JS (`performance.memory`, si existe).
 */
import { MAP } from "../../convex/balanceConfig";
import { generateWorldCells, hexDistance } from "../../convex/territoryRules";
import {
  BASE_HEX_SIZE,
  createCapitalCenteredCamera,
  zoomCameraAtPoint,
} from "./hexMath";
import { MedievalMapRenderer, type MapRenderInput, type RenderableMapCell } from "./mapRenderer";

export type BenchmarkScenarioMode =
  | "pan_continuous"
  | "zoom_continuous"
  | "dynamic_no_terrain"
  | "expedition_progress"
  | "selection_change"
  | "hover_change";

export interface BrowserBenchmarkScenario {
  readonly id: string;
  readonly label: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly dpr: number;
  readonly knownCells: number;
  readonly expeditions: number;
  readonly initialZoom: number;
  readonly mode: BenchmarkScenarioMode;
}

export interface BrowserBenchmarkRunResult {
  readonly runIndex: number;
  readonly totalFrames: number;
  readonly durationMs: number;
  readonly meanFps: number;
  readonly p50FrameMs: number;
  readonly p95FrameMs: number;
  readonly p99FrameMs: number;
  readonly framesOver16_67ms: number;
  readonly framesOver33_33ms: number;
  readonly jsDrawP50Ms: number;
  readonly jsDrawP95Ms: number;
  readonly jsPrepMs: number;
  readonly baseRenderP50Ms: number;
  readonly overlayRenderP50Ms: number;
  readonly hexesProcessed: number;
  readonly expeditionsInspected: number;
  readonly expeditionsDrawn: number;
  readonly baseRedrawCount: number;
  readonly panReuseHits: number;
  readonly stampCacheEntries: number;
  readonly stampCacheBytes: number;
  readonly browserMemory: {
    readonly api: string;
    readonly usedJSHeapBytes: number | null;
    readonly totalJSHeapBytes: number | null;
  };
}

export interface BrowserBenchmarkScenarioSummary {
  readonly scenario: BrowserBenchmarkScenario;
  readonly runs: BrowserBenchmarkRunResult[];
  readonly medianOfRuns: {
    readonly meanFps: number;
    readonly p50FrameMs: number;
    readonly p95FrameMs: number;
    readonly p99FrameMs: number;
    readonly framesOver16_67ms: number;
    readonly framesOver33_33ms: number;
    readonly baseRedrawCount: number;
    readonly meets60FpsBudgetP95: boolean;
    readonly meets30FpsBudgetP95: boolean;
  };
}

export interface BrowserBenchmarkReport {
  readonly percentileMethod: "linear_interpolation_sorted_R7";
  readonly warmupMs: number;
  readonly measureMs: number;
  readonly repetitions: number;
  readonly environment: {
    readonly userAgent: string;
    readonly platform: string;
    readonly devicePixelRatio: number;
    readonly webglRenderer: string | null;
    readonly timestampIso: string;
  };
  readonly scenarios: BrowserBenchmarkScenarioSummary[];
}

/** Percentil exacto por interpolación lineal (método R-7) sobre array ya ordenado ascendentemente. */
export function sortedPercentile(sortedAsc: ReadonlyArray<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = Math.max(0, Math.min(1, p)) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export const MANDATORY_BROWSER_SCENARIOS: ReadonlyArray<BrowserBenchmarkScenario> = [
  { id: "desktop_500_5_close_pan", label: "Escritorio 1440x900 | 500 celdas | 5 exp | Zoom cercano | Pan continuo", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 500, expeditions: 5, initialZoom: 2.2, mode: "pan_continuous" },
  { id: "desktop_2000_50_mid_pan", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Zoom intermedio | Pan continuo", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "pan_continuous" },
  { id: "desktop_7651_200_far_pan", label: "Escritorio 1440x900 | 7651 celdas | 200 exp | Zoom alejado | Pan continuo", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 7651, expeditions: 200, initialZoom: 0.35, mode: "pan_continuous" },
  { id: "desktop_2000_50_zoom", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Zoom continuo", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "zoom_continuous" },
  { id: "desktop_2000_50_dyn", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Datos dinámicos sin cambio terreno", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "dynamic_no_terrain" },
  { id: "desktop_2000_50_exp_prog", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Progreso de expediciones", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "expedition_progress" },
  { id: "desktop_2000_50_select", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Cambio de selección", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "selection_change" },
  { id: "desktop_2000_50_hover", label: "Escritorio 1440x900 | 2000 celdas | 50 exp | Cambio de hover", viewport: { width: 1440, height: 900 }, dpr: 2, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "hover_change" },
  { id: "mobile_500_5_close_pan", label: "Móvil 390x844 | 500 celdas | 5 exp | Zoom cercano | Pan continuo", viewport: { width: 390, height: 844 }, dpr: 3, knownCells: 500, expeditions: 5, initialZoom: 2.2, mode: "pan_continuous" },
  { id: "mobile_2000_50_mid_pan", label: "Móvil 390x844 | 2000 celdas | 50 exp | Zoom intermedio | Pan continuo", viewport: { width: 390, height: 844 }, dpr: 3, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "pan_continuous" },
  { id: "mobile_7651_200_far_pan", label: "Móvil 390x844 | 7651 celdas | 200 exp | Zoom alejado | Pan continuo", viewport: { width: 390, height: 844 }, dpr: 3, knownCells: 7651, expeditions: 200, initialZoom: 0.35, mode: "pan_continuous" },
  { id: "mobile_2000_50_zoom", label: "Móvil 390x844 | 2000 celdas | 50 exp | Zoom continuo", viewport: { width: 390, height: 844 }, dpr: 3, knownCells: 2000, expeditions: 50, initialZoom: 1.25, mode: "zoom_continuous" },
];

let cachedSortedCells: ReturnType<typeof generateWorldCells> | null = null;
function getSortedWorldCells() {
  if (!cachedSortedCells) {
    cachedSortedCells = generateWorldCells(MAP.RADIUS, MAP.WORLD_SEED);
    cachedSortedCells.sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }));
  }
  return cachedSortedCells;
}

function createBenchmarkInput(knownCells: number, expeditions: number, progressOffset: number): MapRenderInput {
  const all = getSortedWorldCells();
  const visibleCells: RenderableMapCell[] = [];
  for (let i = 0; i < Math.min(knownCells, all.length); i++) {
    const c = all[i];
    const isOwned = i < 20;
    const hasExp = i >= 20 && i < 20 + expeditions;
    visibleCells.push({
      cellId: c.cellId,
      q: c.q,
      r: c.r,
      terrain: hasExp ? "desconocido" : c.terrain,
      ownerKingdomId: isOwned ? "k-bench" : i % 37 === 0 ? "k-rival" : null,
      ownerName: isOwned ? "Reino Propio" : i % 37 === 0 ? "Reino Rival" : null,
      ownerColor: isOwned ? "#d4af37" : i % 37 === 0 ? "#dc2626" : null,
      isHome: i === 0,
      state: isOwned ? "owned" : hasExp ? "exploring" : "explored",
      canExplore: false,
      canConquer: false,
      explorationPlan: null,
      expedition: hasExp
        ? {
            expeditionId: `exp-${i}`,
            progressPercent: (i * 7 + progressOffset) % 100,
            completesAt: Date.now() + 60_000,
            durationMs: 120_000,
            distance: hexDistance({ q: 0, r: 0 }, c),
            isSpyMission: i % 3 === 0,
          }
        : null,
    });
  }
  return {
    radius: MAP.RADIUS,
    worldSeed: MAP.WORLD_SEED,
    kingdomId: "k-bench",
    homeTerritoryId: "0,0",
    pendingClaims: 1,
    visibleCells,
    claimableAdjacentIds: new Set(["2,0", "1,1", "-1,2"]),
    activeMarches: [],
  };
}

function readBrowserMemory() {
  const perfAny = performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  };
  if (perfAny.memory) {
    return {
      api: "performance.memory",
      usedJSHeapBytes: perfAny.memory.usedJSHeapSize,
      totalJSHeapBytes: perfAny.memory.totalJSHeapSize,
    };
  }
  return { api: "unavailable", usedJSHeapBytes: null, totalJSHeapBytes: null };
}

function detectWebglRenderer(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl");
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return null;
  }
}

async function runSingleScenarioRepetition(
  canvas: HTMLCanvasElement,
  scenario: BrowserBenchmarkScenario,
  runIndex: number,
  warmupMs: number,
  measureMs: number
): Promise<BrowserBenchmarkRunResult> {
  const renderer = new MedievalMapRenderer(canvas, MAP.RADIUS, MAP.WORLD_SEED);
  renderer.setViewport(scenario.viewport.width, scenario.viewport.height, scenario.dpr);
  const cam0 = createCapitalCenteredCamera({ q: 0, r: 0 }, scenario.initialZoom, BASE_HEX_SIZE);
  renderer.setCamera(cam0);
  renderer.setData(createBenchmarkInput(scenario.knownCells, scenario.expeditions, 0));
  renderer.renderNow();

  const frameDeltas: number[] = [];
  const jsDraws: number[] = [];
  const baseDraws: number[] = [];
  const overlayDraws: number[] = [];

  const all = getSortedWorldCells();

  const stepStimulus = (step: number) => {
    switch (scenario.mode) {
      case "pan_continuous": {
        const angle = step * 0.04;
        renderer.setCamera({
          x: cam0.x + Math.cos(angle) * 90,
          y: cam0.y + Math.sin(angle) * 60,
          zoom: cam0.zoom,
        });
        break;
      }
      case "zoom_continuous": {
        const nextZ = 0.4 + ((Math.sin(step * 0.06) + 1) * 0.5) * 2.0;
        renderer.setCamera(
          zoomCameraAtPoint(renderer.getCamera(), scenario.viewport.width * 0.5, scenario.viewport.height * 0.5, scenario.viewport, nextZ)
        );
        break;
      }
      case "dynamic_no_terrain":
      case "expedition_progress": {
        renderer.setData(createBenchmarkInput(scenario.knownCells, scenario.expeditions, step % 100));
        break;
      }
      case "selection_change": {
        const c = all[step % 60];
        renderer.setSelectedCell(c.q, c.r);
        break;
      }
      case "hover_change": {
        const c = all[step % 60];
        renderer.setHoveredCell(c.q, c.r);
        break;
      }
    }
    renderer.renderNow();
  };

  let baseRedrawsBeforeMeasure = 0;
  let panHitsBeforeMeasure = 0;
  let measureStart = 0;

  await new Promise<void>((resolve) => {
    const startTs = performance.now();
    let lastTs = startTs;
    let step = 0;
    let measuring = false;

    const tick = (now: number) => {
      const elapsed = now - startTs;
      step++;
      stepStimulus(step);

      if (!measuring && elapsed >= warmupMs) {
        measuring = true;
        measureStart = now;
        lastTs = now;
        const snap = renderer.getPerfSnapshot();
        baseRedrawsBeforeMeasure = snap.baseRenderCount;
        panHitsBeforeMeasure = snap.panReuseHitCount;
      } else if (measuring) {
        const dt = now - lastTs;
        lastTs = now;
        frameDeltas.push(dt);
        const snap = renderer.getPerfSnapshot();
        jsDraws.push(snap.lastFrameMs);
        baseDraws.push(snap.lastBaseRenderMs);
        overlayDraws.push(snap.lastOverlayRenderMs);

        if (now - measureStart >= measureMs) {
          resolve();
          return;
        }
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

  const snap = renderer.getPerfSnapshot();
  const totalDuration = Math.max(1, performance.now() - measureStart);
  const sortedFrames = [...frameDeltas].sort((a, b) => a - b);
  const sortedJs = [...jsDraws].sort((a, b) => a - b);
  const sortedBase = [...baseDraws].sort((a, b) => a - b);
  const sortedOverlay = [...overlayDraws].sort((a, b) => a - b);

  const result: BrowserBenchmarkRunResult = {
    runIndex,
    totalFrames: frameDeltas.length,
    durationMs: Number(totalDuration.toFixed(1)),
    meanFps: Number(((frameDeltas.length * 1000) / totalDuration).toFixed(2)),
    p50FrameMs: Number(sortedPercentile(sortedFrames, 0.5).toFixed(3)),
    p95FrameMs: Number(sortedPercentile(sortedFrames, 0.95).toFixed(3)),
    p99FrameMs: Number(sortedPercentile(sortedFrames, 0.99).toFixed(3)),
    framesOver16_67ms: frameDeltas.filter((d) => d > 16.67).length,
    framesOver33_33ms: frameDeltas.filter((d) => d > 33.33).length,
    jsDrawP50Ms: Number(sortedPercentile(sortedJs, 0.5).toFixed(3)),
    jsDrawP95Ms: Number(sortedPercentile(sortedJs, 0.95).toFixed(3)),
    jsPrepMs: Number(snap.lastPrepMs.toFixed(3)),
    baseRenderP50Ms: Number(sortedPercentile(sortedBase, 0.5).toFixed(3)),
    overlayRenderP50Ms: Number(sortedPercentile(sortedOverlay, 0.5).toFixed(3)),
    hexesProcessed: snap.lastVisibleHexCount,
    expeditionsInspected: snap.lastExpeditionsInspected,
    expeditionsDrawn: snap.lastExpeditionsDrawn,
    baseRedrawCount: snap.baseRenderCount - baseRedrawsBeforeMeasure,
    panReuseHits: snap.panReuseHitCount - panHitsBeforeMeasure,
    stampCacheEntries: snap.stampCacheEntries,
    stampCacheBytes: snap.stampCacheBytes,
    browserMemory: readBrowserMemory(),
  };

  renderer.destroy();
  return result;
}

export async function runBrowserBenchmarkSuite(options?: {
  warmupMs?: number;
  measureMs?: number;
  repetitions?: number;
  scenarioIds?: string[];
}): Promise<BrowserBenchmarkReport> {
  const warmupMs = options?.warmupMs ?? 2000;
  const measureMs = options?.measureMs ?? 10000;
  const repetitions = options?.repetitions ?? 3;
  const selected = options?.scenarioIds?.length
    ? MANDATORY_BROWSER_SCENARIOS.filter((s) => options.scenarioIds!.includes(s.id))
    : MANDATORY_BROWSER_SCENARIOS;

  const root = document.getElementById("root") ?? document.body;
  root.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  root.appendChild(canvas);

  const scenarios: BrowserBenchmarkScenarioSummary[] = [];
  for (const scenario of selected) {
    const runs: BrowserBenchmarkRunResult[] = [];
    for (let r = 1; r <= repetitions; r++) {
      runs.push(await runSingleScenarioRepetition(canvas, scenario, r, warmupMs, measureMs));
    }
    const med = (vals: number[]) => sortedPercentile([...vals].sort((a, b) => a - b), 0.5);
    const medP95 = Number(med(runs.map((r) => r.p95FrameMs)).toFixed(3));
    scenarios.push({
      scenario,
      runs,
      medianOfRuns: {
        meanFps: Number(med(runs.map((r) => r.meanFps)).toFixed(2)),
        p50FrameMs: Number(med(runs.map((r) => r.p50FrameMs)).toFixed(3)),
        p95FrameMs: medP95,
        p99FrameMs: Number(med(runs.map((r) => r.p99FrameMs)).toFixed(3)),
        framesOver16_67ms: Math.round(med(runs.map((r) => r.framesOver16_67ms))),
        framesOver33_33ms: Math.round(med(runs.map((r) => r.framesOver33_33ms))),
        baseRedrawCount: Math.round(med(runs.map((r) => r.baseRedrawCount))),
        meets60FpsBudgetP95: medP95 <= 16.67,
        meets30FpsBudgetP95: medP95 <= 33.33,
      },
    });
  }

  return {
    percentileMethod: "linear_interpolation_sorted_R7",
    warmupMs,
    measureMs,
    repetitions,
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      devicePixelRatio: window.devicePixelRatio || 1,
      webglRenderer: detectWebglRenderer(),
      timestampIso: new Date().toISOString(),
    },
    scenarios,
  };
}

/** Monta el harness interactivo y expone `window.__runMapBenchmarkSuite` para Playwright. */
export function mountBrowserBenchmarkPage(): void {
  (window as unknown as { __runMapBenchmarkSuite?: typeof runBrowserBenchmarkSuite }).__runMapBenchmarkSuite =
    runBrowserBenchmarkSuite;

  const root = document.getElementById("root") ?? document.body;
  root.innerHTML = `<div style="padding:16px;font-family:monospace;color:#e5d4b0;background:#0e0c09;min-height:100vh">
    <h1 style="margin:0 0 8px">La Conquista — Benchmark Real Canvas 2D (Puntos 3+4)</h1>
    <p id="bench-status">Listo. Ejecuta <code>window.__runMapBenchmarkSuite()</code> desde Playwright o pulsa el botón.</p>
    <button id="bench-start" style="padding:8px 14px;background:#d4af37;color:#111;border:0;border-radius:6px;cursor:pointer;font-weight:700">Ejecutar benchmark completo (2s warmup + 10s × 3)</button>
    <pre id="bench-output" style="margin-top:16px;white-space:pre-wrap;font-size:12px"></pre>
  </div>`;

  const btn = document.getElementById("bench-start");
  btn?.addEventListener("click", async () => {
    const status = document.getElementById("bench-status");
    if (status) status.textContent = "Ejecutando escenarios en Canvas 2D real...";
    const report = await runBrowserBenchmarkSuite();
    const out = document.getElementById("bench-output");
    if (out) out.textContent = JSON.stringify(report, null, 2);
  });
}
