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
  type TechnologyBalance, LEGACY_CIVILIZATION_IDS,
  CIVILIZATION_IDENTITIES,
  type CivilizationIdentity,
  type ArmorTier,
  type WeaponTier,
  ARMORS,
  BUILDINGS,
  UNITS,
  WEAPONS,
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
/** Traduce identificadores antiguos (indiosAmericanos, keniatas…) al vigente; devuelve el mismo id si ya es actual. */
export function normalizeCivilizationId(id: string | null | undefined): string | null {
  if (!id || typeof id !== "string") return null;
  const trimmed = id.trim();
  return LEGACY_CIVILIZATION_IDS[trimmed] ?? trimmed;
}

export function getCivilization(id: string | null | undefined): CivilizationBalance | null {
  const normalized = normalizeCivilizationId(id);
  if (!normalized) return null;
  return (CIVILIZATION_MAP as Record<string, CivilizationBalance>)[normalized] ?? null;
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
  if (normalizeCivilizationId(civilizationRequirement) !== normalizeCivilizationId(kingdomCivilization)) {
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

// ----------------------------------------------------------------------------
// Singularidades por civilización (decisión 21-10-2026): solo nombre y estética
// ----------------------------------------------------------------------------
/** Identidad (equipo, edificio único, tropa) o null si está pendiente de documentar (Navajos, Masáis). */
export function getCivilizationIdentity(id: string | null | undefined): CivilizationIdentity | null {
  const normalized = normalizeCivilizationId(id);
  if (!normalized) return null;
  return CIVILIZATION_IDENTITIES[normalized] ?? null;
}

export function civilizationWeaponLabel(civId: string | null | undefined, tier: WeaponTier): string {
  const identity = getCivilizationIdentity(civId);
  const generic = WEAPONS[tier]?.label ?? tier;
  return identity ? `${identity.weapons[tier]} (${generic})` : generic;
}

export function civilizationArmorLabel(civId: string | null | undefined, tier: ArmorTier): string {
  const identity = getCivilizationIdentity(civId);
  const generic = ARMORS[tier]?.label ?? tier;
  return identity ? `${identity.armors[tier]} (${generic})` : generic;
}

/** Nombre del edificio para la civilización: el único lleva su nombre propio y el base entre paréntesis. */
export function civilizationBuildingLabel(civId: string | null | undefined, buildingType: string): string {
  const generic = BUILDINGS[buildingType]?.label ?? buildingType;
  const identity = getCivilizationIdentity(civId);
  if (identity && identity.uniqueBuilding.buildingType === buildingType) return `${identity.uniqueBuilding.name} (${generic})`;
  return generic;
}

export function civilizationUnitLabel(civId: string | null | undefined, unitType: UnitType): string {
  const generic = UNITS[unitType]?.label ?? unitType;
  const identity = getCivilizationIdentity(civId);
  const own = identity?.unitNames[unitType];
  return own ? `${own} (${generic})` : generic;
}

/** [DECISIÓN 21-10-2026] Debilidad: sobrecoste de instrucción por tipo de unidad (1 si no aplica). */
export function civilizationTrainingCostMultiplier(unitType: UnitType, civId?: string | null): number {
  const passive = getCivilizationPassive(civId);
  const value = passive.trainingCostByUnit?.[unitType];
  return typeof value === "number" && value > 0 ? value : 1;
}

/** Ficha pública de una civilización (para invitados y asistente de fundación). */
export function describeCivilizationIdentity(civ: CivilizationBalance) {
  const identity = getCivilizationIdentity(civ.id);
  return {
    id: civ.id,
    label: civ.label,
    emblem: civ.emblem,
    style: civ.style,
    advantage: civ.passive.description,
    weakness: civ.passive.weakness ?? null,
    identity: identity
      ? {
          weapons: identity.weapons,
          armors: identity.armors,
          uniqueBuilding: { ...identity.uniqueBuilding, baseLabel: BUILDINGS[identity.uniqueBuilding.buildingType]?.label ?? identity.uniqueBuilding.buildingType },
          signatureUnit: { ...identity.signatureUnit, baseLabel: UNITS[identity.signatureUnit.unitType]?.label ?? identity.signatureUnit.unitType },
          unitNames: identity.unitNames,
        }
      : null,
    pendingDesign: !identity || !civ.passive.weakness,
  };
}
