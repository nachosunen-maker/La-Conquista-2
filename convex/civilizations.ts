/**
 * LA CONQUISTA — CIVILIZACIONES (Bloque H, P6, D-43 a D-45)
 * Doce civilizaciones de la Especificación Maestra. Se eligen al fundar el reino
 * y son inmutables. Sin bonificaciones numéricas hasta aprobación de balance (D-44).
 */
import { query } from "./_generated/server";
import { CIVILIZATIONS, CIVILIZATION_BONUSES_ENABLED, CIVILIZATION_IMMUTABLE, type CivilizationId } from "./balanceConfig";

export function isCivilizationId(value: unknown): value is CivilizationId {
  return typeof value === "string" && CIVILIZATIONS.some((civilization) => civilization.id === value);
}

export function civilizationLabel(id: string | undefined | null): string | null {
  return CIVILIZATIONS.find((civilization) => civilization.id === id)?.label ?? null;
}

export const OFFICIAL_CIVILIZATIONS = CIVILIZATIONS;
export const isValidCivilization = isCivilizationId;
export function getCivilizationById(id: string) {
  return CIVILIZATIONS.find((c) => c.id === id) ?? null;
}

export { getCivilizationStrategicMatrix } from "./civilizationRules";
import { describeCivilizationIdentity } from "./civilizationRules";

export const listCivilizations = query({
  args: {},
  handler: async () => ({
    civilizations: CIVILIZATIONS,
    // [Decisión 21-10-2026] Ficha pública: ventaja, debilidad, equipo, edificio único y tropa (visible para invitados).
    profiles: CIVILIZATIONS.map((civ) => describeCivilizationIdentity(civ)),
    bonusesEnabled: CIVILIZATION_BONUSES_ENABLED,
    immutable: CIVILIZATION_IMMUTABLE,
  }),
});

export const getCivilizationMatrix = query({
  args: {},
  handler: async () => ({
    matrix: (await import("./civilizationRules")).getCivilizationStrategicMatrix(),
    bonusesEnabled: CIVILIZATION_BONUSES_ENABLED,
    totalCivilizations: CIVILIZATIONS.length,
  }),
});

