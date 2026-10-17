/**
 * LA CONQUISTA — LÓGICA PURA DE EDIFICIOS, CONSTRUCCIÓN Y ECONOMÍA INTEGRADA
 * Módulo determinista sin dependencias del runtime de Convex.
 * 
 * Reglas implementadas:
 * 1. Máximo 2 construcciones simultáneas por reino.
 * 2. Cancelación con confirmación previa y devolución estricta del 50% de recursos pagados.
 * 3. Solo se pueden cancelar obras en curso (status === "in_progress" y tiempo no vencido).
 * 4. Idempotencia y prevención de doble finalización / doble cobro / doble reembolso.
 * 5. Integración con economía:
 *    - Capacidad productiva determinada por el edificio.
 *    - Producción efectiva = Math.min(trabajadores, capacidadEdificio) * productividadBase.
 *    - Sin trabajadores asignados => producción = 0 (ningún edificio produce gratis).
 *    - Trabajadores por encima de capacidad => no producen más allá de la capacidad del edificio.
 */

import { type KingdomResources, type WorkersDistribution } from "./economyCalculations";
import {
  BUILDINGS_CATALOG,
  getBuildingDefinition,
  calculateConstructionDuration,
  calculateUpgradeCost,
  hasSufficientResources,
  validateBuildingProgression,
  calculateResidentialCapacity,
  calculateWorkerCapacity,
  MAX_SIMULTANEOUS_CONSTRUCTIONS,
  CANCEL_REFUND_PERCENTAGE,
  MAX_BUILDING_LEVEL,
} from "./buildingsCatalog";

export interface ConstructionQueueItem {
  _id?: string;
  kingdomId: string;
  buildingType: string;
  currentLevel: number;
  targetLevel: number;
  cost: KingdomResources;
  startTime: number;
  durationSeconds: number;
  endTime: number;
  status: "in_progress" | "completed" | "cancelled";
  completedAt?: number;
  cancelledAt?: number;
  refund?: KingdomResources;
}

export interface BuildingState {
  buildingType: string;
  level: number;
}

/**
 * Valida si el reino tiene espacio en su cuadrilla de obras (máx 2 simultáneas).
 */
export function validateQueueAvailability(
  activeQueue: ConstructionQueueItem[],
  maxSlots: number = MAX_SIMULTANEOUS_CONSTRUCTIONS
): { available: boolean; activeCount: number; error?: string } {
  const activeCount = activeQueue.filter((item) => item.status === "in_progress").length;
  if (activeCount >= maxSlots) {
    return {
      available: false,
      activeCount,
      error: `Cuadrilla de obras completa: ya hay ${activeCount} construcciones en curso (máximo ${maxSlots} simultáneas por reino).`,
    };
  }
  return { available: true, activeCount };
}

/**
 * Comprueba si un edificio ya está en cola de construcción.
 */
export function isBuildingAlreadyInConstruction(
  activeQueue: ConstructionQueueItem[],
  buildingType: string
): boolean {
  return activeQueue.some(
    (item) => item.buildingType === buildingType && item.status === "in_progress"
  );
}

/**
 * Calcula el progreso y tiempo restante de un ítem de la cola según el tiempo del servidor.
 */
export function calculateConstructionProgress(
  item: ConstructionQueueItem,
  currentServerTimeMs: number
): {
  progressPercent: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  isReadyToComplete: boolean;
} {
  const durationMs = item.durationSeconds * 1000;
  const elapsedMs = Math.max(0, currentServerTimeMs - item.startTime);
  const remainingMs = Math.max(0, item.endTime - currentServerTimeMs);

  const progress = durationMs > 0 ? Math.min(1.0, elapsedMs / durationMs) : 1.0;
  const isReady = currentServerTimeMs >= item.endTime && item.status === "in_progress";

  return {
    progressPercent: Math.round(progress * 100),
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    remainingSeconds: Math.ceil(remainingMs / 1000),
    isReadyToComplete: isReady,
  };
}

/**
 * Calcula el reembolso del 50% para cada recurso en caso de cancelación.
 * Regla: estrictamente 50% devuelto, redondeado hacia abajo por seguridad económica.
 */
export function calculateCancellationRefund(cost: KingdomResources): KingdomResources {
  return {
    gold: Math.floor(cost.gold * CANCEL_REFUND_PERCENTAGE),
    wood: Math.floor(cost.wood * CANCEL_REFUND_PERCENTAGE),
    stone: Math.floor(cost.stone * CANCEL_REFUND_PERCENTAGE),
    iron: Math.floor(cost.iron * CANCEL_REFUND_PERCENTAGE),
    food: Math.floor(cost.food * CANCEL_REFUND_PERCENTAGE),
  };
}

/**
 * Valida si una construcción puede ser cancelada.
 * Regla: Solo obras en curso (status === "in_progress") y cuyo tiempo no haya expirado en el servidor.
 */
export function validateCancellationEligibility(
  item: ConstructionQueueItem,
  currentServerTimeMs: number
): { canCancel: boolean; error?: string; isAlreadyFinished?: boolean } {
  if (item.status === "completed") {
    return {
      canCancel: false,
      error: "No se puede cancelar una construcción que ya ha sido completada.",
    };
  }

  if (item.status === "cancelled") {
    return {
      canCancel: false,
      error: "Esta construcción ya fue cancelada previamente (idempotencia estricta).",
    };
  }

  if (item.status !== "in_progress") {
    return {
      canCancel: false,
      error: `Estado de construcción no válido para cancelación: '${item.status}'.`,
    };
  }

  // Si el tiempo en servidor ya expiró, la obra está lista para completarse, no para cancelar
  if (currentServerTimeMs >= item.endTime) {
    return {
      canCancel: false,
      isAlreadyFinished: true,
      error: "La obra ya ha finalizado su tiempo de construcción. Debe completarse, no cancelarse.",
    };
  }

  return { canCancel: true };
}

/**
 * Valida si una construcción puede ser completada.
 */
export function validateCompletionEligibility(
  item: ConstructionQueueItem,
  currentServerTimeMs: number
): { canComplete: boolean; error?: string } {
  if (item.status === "completed") {
    return {
      canComplete: false,
      error: "Esta construcción ya fue completada previamente (prevención de doble finalización).",
    };
  }

  if (item.status === "cancelled") {
    return {
      canComplete: false,
      error: "No se puede completar una construcción cancelada.",
    };
  }

  if (currentServerTimeMs < item.endTime) {
    const remainingSecs = Math.ceil((item.endTime - currentServerTimeMs) / 1000);
    return {
      canComplete: false,
      error: `Construcción en progreso: faltan ${remainingSecs} segundos para finalizar.`,
    };
  }

  return { canComplete: true };
}

/**
 * Producción efectiva con capacidad de edificio:
 * "La capacidad productiva depende del tipo y nivel del edificio; la producción efectiva depende también de los trabajadores asignados.
 * Ningún edificio debe producir gratuitamente sin trabajadores ni superar su capacidad."
 */
export function calculateEffectiveProductiveYield(params: {
  assignedWorkers: number;
  buildingLevel: number;
  buildingType: "granja" | "aserradero" | "cantera" | "minaHierro";
  baseProductivityPerWorker: number;
}): {
  buildingCapacity: number;
  effectiveWorkers: number;
  idleCapacity: number;
  excessWorkers: number;
  dailyProduction: number;
} {
  const { assignedWorkers, buildingLevel, buildingType, baseProductivityPerWorker } = params;

  // 1. Si no hay nivel de edificio, capacidad es 0
  const buildingCapacity = calculateWorkerCapacity(buildingType, buildingLevel);

  // 2. Si no hay trabajadores asignados, producción es 0 (no produce gratis)
  if (assignedWorkers <= 0 || buildingCapacity <= 0) {
    return {
      buildingCapacity,
      effectiveWorkers: 0,
      idleCapacity: buildingCapacity,
      excessWorkers: Math.max(0, assignedWorkers),
      dailyProduction: 0,
    };
  }

  // 3. Trabajadores efectivos limitados por la capacidad del edificio
  const effectiveWorkers = Math.min(assignedWorkers, buildingCapacity);
  const excessWorkers = Math.max(0, assignedWorkers - buildingCapacity);
  const idleCapacity = Math.max(0, buildingCapacity - assignedWorkers);

  // 4. Producción efectiva diaria
  const dailyProduction = effectiveWorkers * baseProductivityPerWorker;

  return {
    buildingCapacity,
    effectiveWorkers,
    idleCapacity,
    excessWorkers,
    dailyProduction,
  };
}

/**
 * Extrae un mapa de niveles { [buildingType]: level } a partir de un array de edificios.
 */
export function mapBuildingLevels(
  buildings: { buildingType: string; level: number }[] | null | undefined
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!buildings || !Array.isArray(buildings)) return map;

  for (const b of buildings) {
    if (b && typeof b.buildingType === "string") {
      map[b.buildingType] = Math.max(0, b.level ?? 0);
    }
  }

  return map;
}
