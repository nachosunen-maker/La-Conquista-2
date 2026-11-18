/**
 * LA CONQUISTA — REGLAS PURAS DEL PARLAMENTO Y DESAFÍOS (Bloque E, P38-P42, P58-P60, D-34 a D-42)
 * Máquina de estados server-authoritative (docs/BLOQUE_9.txt):
 *   PENDING → ACCEPTED | REJECTED | EXPIRED
 *   ACCEPTED → FROZEN → RESOLVED
 * Sin acceso a Convex.
 */
import type { ResourceType } from "./economyCalculations";
import { PARLIAMENT, PREDEFINED_MESSAGES, type ScheduleWindow } from "./balanceConfig";

export type ChallengeStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "FROZEN" | "RESOLVED" | "EXPIRED" | "CANCELLED";

export const CHALLENGE_TRANSITIONS: Readonly<Record<ChallengeStatus, readonly ChallengeStatus[]>> = {
  PENDING: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["FROZEN", "CANCELLED"],
  FROZEN: ["RESOLVED", "CANCELLED"],
  REJECTED: [],
  RESOLVED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransition(from: ChallengeStatus, to: ChallengeStatus): boolean {
  return CHALLENGE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ChallengeStatus, to: ChallengeStatus): { success: true } | { success: false; error: string } {
  if (!canTransition(from, to)) {
    return { success: false, error: `Transición inválida del desafío: ${from} → ${to}.` };
  }
  return { success: true };
}

export const SCHEDULE_WINDOWS: readonly ScheduleWindow[] = ["proxima", "dias", "semana"];

export function isScheduleWindow(value: string): value is ScheduleWindow {
  return (SCHEDULE_WINDOWS as readonly string[]).includes(value);
}

/** [MAESTRA P38 + D-35] Fecha de batalla y de congelación según la ventana elegida. */
export function scheduleFor(acceptedAt: number, window: ScheduleWindow): { scheduledAt: number; freezeAt: number } {
  const scheduledAt = acceptedAt + PARLIAMENT.SCHEDULE_WINDOWS_MS[window];
  return { scheduledAt, freezeAt: scheduledAt - PARLIAMENT.FREEZE_BEFORE_BATTLE_MS };
}

/** [COMPLEMENTO D-34] 2 % de cada recurso, mínimo 10, máximo 500, sin bajar de cero. */
export function rejectionPenalty(resources: Record<ResourceType, number>): Record<ResourceType, number> {
  const penalty = {} as Record<ResourceType, number>;
  for (const resource of ["gold", "wood", "stone", "iron", "food"] as const) {
    const balance = Math.max(0, Number.isFinite(resources[resource]) ? resources[resource] : 0);
    const raw = balance * PARLIAMENT.REJECTION_PENALTY_RATIO;
    const bounded = Math.min(PARLIAMENT.REJECTION_PENALTY_MAX, Math.max(PARLIAMENT.REJECTION_PENALTY_MIN, raw));
    penalty[resource] = Math.min(balance, Math.floor(bounded));
  }
  return penalty;
}

export interface ExistingChallengeSummary {
  challengerKingdomId: string;
  targetKingdomId: string;
  status: ChallengeStatus;
  createdAt: number;
}

/** [COMPLEMENTO D-40, D-42] Validación de un nuevo desafío. */
export function validateNewChallenge(input: {
  challengerKingdomId: string;
  targetKingdomId: string;
  challengerParliamentLevel: number;
  targetParliamentLevel: number;
  existing: ReadonlyArray<ExistingChallengeSummary>;
  now: number;
}): { success: true } | { success: false; error: string } {
  if (input.challengerKingdomId === input.targetKingdomId) {
    return { success: false, error: "Un reino no puede desafiarse a sí mismo." };
  }
  if (input.challengerParliamentLevel < PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL) {
    return { success: false, error: `Se necesita Parlamento nivel ${PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL} para enviar desafíos.` };
  }
  if (input.targetParliamentLevel < PARLIAMENT.REQUIRED_PARLIAMENT_LEVEL) {
    return { success: false, error: "El reino rival aún no tiene Parlamento; no puede recibir desafíos." };
  }
  const open = input.existing.filter((c) => c.status === "PENDING" || c.status === "ACCEPTED" || c.status === "FROZEN");
  const pendingByChallenger = open.filter((c) => c.challengerKingdomId === input.challengerKingdomId && c.status === "PENDING");
  if (pendingByChallenger.length >= PARLIAMENT.MAX_PENDING_PER_KINGDOM) {
    return { success: false, error: `Ya tienes ${PARLIAMENT.MAX_PENDING_PER_KINGDOM} desafíos pendientes de respuesta.` };
  }
  const duplicate = open.find((c) =>
    (c.challengerKingdomId === input.challengerKingdomId && c.targetKingdomId === input.targetKingdomId) ||
    (c.challengerKingdomId === input.targetKingdomId && c.targetKingdomId === input.challengerKingdomId)
  );
  if (duplicate) {
    return { success: false, error: "Ya existe un desafío abierto entre ambos reinos." };
  }
  const recent = input.existing.find((c) =>
    c.challengerKingdomId === input.challengerKingdomId && c.targetKingdomId === input.targetKingdomId &&
    input.now - c.createdAt < PARLIAMENT.SAME_RIVAL_COOLDOWN_MS
  );
  if (recent) {
    const remainingMs = PARLIAMENT.SAME_RIVAL_COOLDOWN_MS - (input.now - recent.createdAt);
    return { success: false, error: `Debes esperar ${Math.ceil(remainingMs / 60_000)} minutos antes de volver a desafiar a este rival.` };
  }
  return { success: true };
}

export function isPredefinedMessage(id: string): boolean {
  return PREDEFINED_MESSAGES.some((message) => message.id === id);
}

export function predefinedMessageText(id: string): string | null {
  return PREDEFINED_MESSAGES.find((message) => message.id === id)?.text ?? null;
}

/** [MAESTRA P42 + D-39] Estimación aproximada de efectivos con error según nivel de espionaje. */
export function approximateEstimate(exact: number, espionageLevel: number): { min: number; max: number; error: number } {
  const error = PARLIAMENT.ESPIONAGE.errorByLevel[espionageLevel] ?? PARLIAMENT.ESPIONAGE.errorByLevel[0];
  // Redondeo previo a 6 decimales para evitar que 1000 × 0,93 = 929,999… caiga a 929.
  const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
  return {
    min: Math.max(0, Math.floor(round6(exact * (1 - error)))),
    max: Math.ceil(round6(exact * (1 + error))),
    error,
  };
}

/** Redondeo a centenas para la población aproximada ("aproximadamente 8.000", P42). */
export function approximatePopulation(exact: number): number {
  return Math.round(exact / 100) * 100;
}

export function pendingExpiry(createdAt: number): number {
  return createdAt + PARLIAMENT.PENDING_EXPIRY_MS;
}

export const validateNewChallengeInput = validateNewChallenge;
export const calculateScheduledExecutionTime = scheduleFor;
export const isValidWindowOption = isScheduleWindow;
export const validateChallengeStateTransition = assertTransition;
