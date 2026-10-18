import {
  approximateEstimate,
  approximatePopulation,
  canTransition,
  isPredefinedMessage,
  predefinedMessageText,
  rejectionPenalty,
  scheduleFor,
  validateNewChallenge,
  type ChallengeStatus,
} from "./challengeRules";
import { PARLIAMENT, PREDEFINED_MESSAGES, TIME } from "./balanceConfig";

export interface ChallengeTestResult {
  test: string;
  passed: boolean;
  details: string;
}

export function runChallengeValidationTests(): ChallengeTestResult[] {
  const statuses: ChallengeStatus[] = ["PENDING", "ACCEPTED", "REJECTED", "FROZEN", "RESOLVED", "EXPIRED"];
  const allowed = [["PENDING", "ACCEPTED"], ["PENDING", "REJECTED"], ["PENDING", "EXPIRED"], ["ACCEPTED", "FROZEN"], ["FROZEN", "RESOLVED"]] as const;
  const validCount = statuses.flatMap((from) => statuses.map((to) => [from, to] as const)).filter(([from, to]) => canTransition(from, to)).length;
  const forbidden = !canTransition("REJECTED", "FROZEN") && !canTransition("RESOLVED", "ACCEPTED") && !canTransition("PENDING", "FROZEN") && !canTransition("FROZEN", "FROZEN");

  const acceptedAt = 1_000_000;
  const near = scheduleFor(acceptedAt, "proxima");
  const week = scheduleFor(acceptedAt, "semana");

  const penaltySmall = rejectionPenalty({ gold: 100, wood: 5, stone: 0, iron: 30_000, food: 40_000 });
  const penaltyRich = rejectionPenalty({ gold: 100_000, wood: 100_000, stone: 100_000, iron: 100_000, food: 100_000 });

  const base = { challengerKingdomId: "a", targetKingdomId: "b", challengerParliamentLevel: 1, targetParliamentLevel: 1, existing: [], now: 10_000_000 };
  const ok = validateNewChallenge(base);
  const self = validateNewChallenge({ ...base, targetKingdomId: "a" });
  const noParliament = validateNewChallenge({ ...base, challengerParliamentLevel: 0 });
  const targetNoParliament = validateNewChallenge({ ...base, targetParliamentLevel: 0 });
  const pending3 = validateNewChallenge({ ...base, existing: ["x", "y", "z"].map((t) => ({ challengerKingdomId: "a", targetKingdomId: t, status: "PENDING" as const, createdAt: 0 })) });
  const duplicateReverse = validateNewChallenge({ ...base, existing: [{ challengerKingdomId: "b", targetKingdomId: "a", status: "ACCEPTED", createdAt: 0 }] });
  const cooldown = validateNewChallenge({ ...base, existing: [{ challengerKingdomId: "a", targetKingdomId: "b", status: "REJECTED", createdAt: base.now - 60 * 60 * 1000 }] });
  const cooldownOver = validateNewChallenge({ ...base, existing: [{ challengerKingdomId: "a", targetKingdomId: "b", status: "REJECTED", createdAt: base.now - PARLIAMENT.SAME_RIVAL_COOLDOWN_MS - 1 }] });

  const estimate0 = approximateEstimate(1000, 0);
  const estimate2 = approximateEstimate(1000, 2);

  return [
    {
      test: "Máquina de estados disjunta (BLOQUE 9): solo 5 transiciones válidas; rechazado y resuelto son finales",
      passed: validCount === allowed.length && allowed.every(([from, to]) => canTransition(from, to)) && forbidden,
      details: `Transiciones válidas: ${validCount}; prohibidas comprobadas: ${forbidden}`,
    },
    {
      test: "Ventanas de programación (P38, D-35): 1, 3 y 7 días reales; congelación 15 minutos antes (D-36)",
      passed: near.scheduledAt === acceptedAt + TIME.MS_PER_GAME_YEAR && week.scheduledAt === acceptedAt + 7 * TIME.MS_PER_GAME_YEAR &&
        near.freezeAt === near.scheduledAt - 15 * 60 * 1000,
      details: `Próxima: +${(near.scheduledAt - acceptedAt) / 3_600_000} h; semana: +${(week.scheduledAt - acceptedAt) / 3_600_000} h; congelación ${(near.scheduledAt - near.freezeAt) / 60_000} min antes`,
    },
    {
      test: "Penalización por rechazo (D-34): 2 % con mínimo 10, máximo 500 y nunca por debajo de cero",
      passed: penaltySmall.gold === 10 && penaltySmall.wood === 5 && penaltySmall.stone === 0 && penaltySmall.iron === 500 && penaltySmall.food === 500 &&
        penaltyRich.gold === 500,
      details: `Oro 100→${penaltySmall.gold}; madera 5→${penaltySmall.wood}; piedra 0→${penaltySmall.stone}; hierro 30.000→${penaltySmall.iron}; rico→${penaltyRich.gold}`,
    },
    {
      test: "Nuevo desafío (D-40, D-42): Parlamento 1 en ambos, máximo 3 pendientes, sin duplicados y 24 h de espera por rival",
      passed: ok.success && !self.success && !noParliament.success && !targetNoParliament.success && !pending3.success &&
        !duplicateReverse.success && !cooldown.success && cooldownOver.success,
      details: `Válido ${ok.success}; a sí mismo ${!self.success}; sin parlamento ${!noParliament.success}/${!targetNoParliament.success}; 3 pendientes ${!pending3.success}; duplicado inverso ${!duplicateReverse.success}; enfriamiento ${!cooldown.success}/${cooldownOver.success}`,
    },
    {
      test: "Mensajes predefinidos P60 (cinco, sin chat libre) e información aproximada del enemigo (P42, D-39)",
      passed: PREDEFINED_MESSAGES.length === 5 && isPredefinedMessage("campo") && !isPredefinedMessage("hola") &&
        predefinedMessageText("reto") === "¿Te atreves a retarme?" &&
        estimate0.min === 750 && estimate0.max === 1250 && estimate2.min === 930 && estimate2.max === 1070 && approximatePopulation(8_049) === 8_000,
      details: `Mensajes ${PREDEFINED_MESSAGES.length}; estimación sin espionaje ${estimate0.min}-${estimate0.max}; con Espionaje II ${estimate2.min}-${estimate2.max}`,
    },
  ];
}
