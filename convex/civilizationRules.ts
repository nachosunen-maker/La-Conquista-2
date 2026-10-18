/**
 * LA CONQUISTA — REGLAS PURAS DE CIVILIZACIONES Y BONIFICACIONES (Bloque H, P6, P62, D-43 a D-45)
 * Identidad estratégica de las 12 civilizaciones oficiales de La Conquista.
 * Bonificaciones pasivas calibradas (5 %–15 %) y tecnologías únicas de la Universidad.
 * Totalmente desacoplado de la base de datos; opera como lógica matemática pura y determinista.
 */
import {
  CIVILIZATIONS,
  CIVILIZATION_BONUSES_ENABLED,
  type CivilizationBalance,
  type CivilizationId,
  type CivilizationPassiveConfig,
  type ProductiveJob,
  type UnitType,
  TECHNOLOGIES,
  type TechnologyBalance,
} from "./balanceConfig";

export const NEUTRAL_PASSIVE: CivilizationPassiveConfig = {
  description: "Sin bonificaciones culturales activas",
  production: {},
  constructionDurationMultiplier: 1.0,
  researchDurationMultiplier: 1.0,
  explorationDurationMultiplier: 1.0,
  explorationCostMultiplier: 1.0,
  woundedRecoveryBonus: 0,
  marchSpeedMultiplier: 1.0,
  fatigueAccrualMultiplier: 1.0,
  residentialCapacityMultiplier: 1.0,
  storageCapacityMultiplier: 1.0,
  trainingDurationByUnit: {},
  combatAttackMultiplier: 1.0,
  combatDefenseMultiplier: 1.0,
  happinessBonus: 0,
};

/** Mapa indexado de civilizaciones canónicas por identificador único. */
export const CIVILIZATION_MAP: Readonly<Record<CivilizationId, CivilizationBalance>> = Object.fromEntries(
  CIVILIZATIONS.map((civ) => [civ.id, civ])
) as Record<CivilizationId, CivilizationBalance>;

/** Obtiene la definición completa de una civilización o null si no existe. */
export function getCivilization(id: string | null | undefined): CivilizationBalance | null {
  if (!id || typeof id !== "string") return null;
  return (CIVILIZATION_MAP as Record<string, CivilizationBalance>)[id.trim()] ?? null;
}

/** Devuelve la configuración pasiva aplicable según el reino y el flag de bonificaciones. */
export function getCivilizationPassive(id: string | null | undefined): CivilizationPassiveConfig {
  if (!CIVILIZATION_BONUSES_ENABLED) return NEUTRAL_PASSIVE;
  const civ = getCivilization(id);
  return civ ? civ.passive : NEUTRAL_PASSIVE;
}

/** Obtiene la tecnología única asociada a una civilización. */
export function getUniqueTechForCivilization(civId: string | null | undefined): TechnologyBalance | null {
  const civ = getCivilization(civId);
  if (!civ) return null;
  return TECHNOLOGIES.find((t) => t.id === civ.uniqueTechnologyId) ?? null;
}

/** Valida si un reino puede investigar una tecnología con restricción de civilización (P62). */
export function validateCivilizationTechAccess(
  civilizationRequirement?: string,
  kingdomCivilization?: string | null
): { allowed: boolean; error?: string } {
  if (!civilizationRequirement) return { allowed: true };
  if (!kingdomCivilization) {
    const requiredCiv = getCivilization(civilizationRequirement);
    return {
      allowed: false,
      error: `Tecnología reservada a la civilización ${requiredCiv?.label ?? civilizationRequirement}; el reino no tiene civilización asignada.`,
    };
  }
  if (civilizationRequirement !== kingdomCivilization) {
    const requiredCiv = getCivilization(civilizationRequirement);
    return {
      allowed: false,
      error: `Tecnología exclusiva de los ${requiredCiv?.label ?? civilizationRequirement} (el reino pertenece a ${getCivilization(kingdomCivilization)?.label ?? kingdomCivilization}).`,
    };
  }
  return { allowed: true };
}

/** Aplica bonificación pasiva a la tasa de producción de un oficio. */
export function applyCivilizationProductionBonus(
  job: ProductiveJob,
  baseRate: number,
  civId?: string | null
): number {
  if (!Number.isFinite(baseRate) || baseRate <= 0) return 0;
  const passive = getCivilizationPassive(civId);
  const bonus = passive.production[job] ?? 0;
  return baseRate * (1 + bonus);
}

/** Aplica bonificación pasiva de duración de construcción. */
export function applyCivilizationConstructionDuration(
  baseDurationMs: number,
  civId?: string | null
): number {
  if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0) return 0;
  const passive = getCivilizationPassive(civId);
  return Math.ceil(baseDurationMs * passive.constructionDurationMultiplier);
}

/** Aplica bonificación pasiva de duración de investigación tecnológica. */
export function applyCivilizationResearchDuration(
  baseDurationSeconds: number,
  civId?: string | null
): number {
  if (!Number.isFinite(baseDurationSeconds) || baseDurationSeconds <= 0) return 0;
  const passive = getCivilizationPassive(civId);
  return Math.ceil(baseDurationSeconds * passive.researchDurationMultiplier);
}

/** Aplica bonificaciones pasivas de exploración territorial (coste y duración). */
export function applyCivilizationExploration(
  baseCosts: { gold: number; food: number },
  baseDurationMs: number,
  civId?: string | null
): { costs: { gold: number; food: number }; durationMs: number } {
  const passive = getCivilizationPassive(civId);
  return {
    costs: {
      gold: Math.ceil(baseCosts.gold * passive.explorationCostMultiplier),
      food: Math.ceil(baseCosts.food * passive.explorationCostMultiplier),
    },
    durationMs: Math.ceil(baseDurationMs * passive.explorationDurationMultiplier),
  };
}

/** Aplica bonificaciones de marcha (velocidad y fatiga). */
export function applyCivilizationMarch(
  baseDurationSeconds: number,
  baseFatigueAccrued: number,
  civId?: string | null
): { durationSeconds: number; fatigueAccrued: number } {
  const passive = getCivilizationPassive(civId);
  const durationSeconds = passive.marchSpeedMultiplier > 0
    ? Math.max(1, Math.ceil(baseDurationSeconds / passive.marchSpeedMultiplier))
    : baseDurationSeconds;
  const fatigueAccrued = Math.max(0, Math.ceil(baseFatigueAccrued * passive.fatigueAccrualMultiplier));
  return { durationSeconds, fatigueAccrued };
}

/** Aplica bonificaciones militares de combate (ataque y defensa). */
export function applyCivilizationCombat(
  baseAttack: number,
  baseDefense: number,
  civId?: string | null
): { attack: number; defense: number } {
  const passive = getCivilizationPassive(civId);
  return {
    attack: baseAttack * passive.combatAttackMultiplier,
    defense: baseDefense * passive.combatDefenseMultiplier,
  };
}

/** Aplica bonificación de duración de entrenamiento según tipo de unidad. */
export function applyCivilizationTrainingDuration(
  unitType: UnitType,
  baseDurationMs: number,
  civId?: string | null
): number {
  if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0) return 0;
  const passive = getCivilizationPassive(civId);
  const modifier = passive.trainingDurationByUnit[unitType] ?? 1.0;
  return Math.ceil(baseDurationMs * modifier);
}

/** Devuelve la matriz comparativa completa de las 12 civilizaciones para interfaz y documentación. */
export function getCivilizationStrategicMatrix() {
  return CIVILIZATIONS.map((civ) => {
    const uniqueTech = TECHNOLOGIES.find((t) => t.id === civ.uniqueTechnologyId);
    return {
      id: civ.id,
      label: civ.label,
      emblem: civ.emblem,
      style: civ.style,
      passive: civ.passive,
      uniqueTech: uniqueTech
        ? {
            id: uniqueTech.id,
            name: uniqueTech.name,
            description: uniqueTech.effect.description,
            costs: uniqueTech.costs,
            universityLevel: uniqueTech.universityLevel,
          }
        : null,
    };
  });
}
