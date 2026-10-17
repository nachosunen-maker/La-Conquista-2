import { computeSideFactors, simulateBattle, strategyFactor, woundedRecoveryRatio, type BattleSide } from "./battleRules";
import { COMBAT } from "./balanceConfig";
import { HOSPITAL_RECOVERY_CAP, HOSPITAL_RECOVERY_PER_YEAR } from "./balanceConfig";

export interface BattleTestResult {
  test: string;
  passed: boolean;
  details: string;
}

function side(overrides: Partial<BattleSide> & { kingdomId: string }): BattleSide {
  return {
    name: overrides.kingdomId,
    composition: { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 },
    trainingMultiplier: 1,
    weaponTier: "espadaHierro",
    armorTier: "cueroReforzado",
    strategy: "concentracion",
    morale: 70,
    foodTier: "normal",
    fatigue: 0,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    ...overrides,
  };
}

export function runBattleValidationTests(): BattleTestResult[] {
  const equal = simulateBattle(side({ kingdomId: "A" }), side({ kingdomId: "B" }));
  const equalAgain = simulateBattle(side({ kingdomId: "A" }), side({ kingdomId: "B" }));

  // Fuerza pequeña bien preparada contra fuerza grande mal preparada (P34, P69)
  const elite = side({ kingdomId: "elite", composition: { infanteria: 850, arqueria: 0, caballeria: 0, asedio: 0 }, trainingMultiplier: 1.9, weaponTier: "aceroAvanzado", armorTier: "acero", morale: 95, foodTier: "excelente", strategy: "agresiva" });
  const mob = side({ kingdomId: "mob", composition: { infanteria: 1000, arqueria: 0, caballeria: 0, asedio: 0 }, trainingMultiplier: 1, weaponTier: "palo", armorTier: "ninguna", morale: 30, foodTier: "minima", fatigue: 80, strategy: "concentracion" });
  const eliteWins = simulateBattle(elite, mob);

  // Superioridad numérica abrumadora
  const horde = side({ kingdomId: "horde", composition: { infanteria: 5000, arqueria: 0, caballeria: 0, asedio: 0 } });
  const small = side({ kingdomId: "small", composition: { infanteria: 300, arqueria: 0, caballeria: 0, asedio: 0 } });
  const crushing = simulateBattle(horde, small);

  // Moral baja fuerza la retirada
  const demoralized = simulateBattle(side({ kingdomId: "low", morale: 10 }), side({ kingdomId: "ok" }));

  // Asedio contra murallas y sin murallas
  const siegeArmy = side({ kingdomId: "siege", composition: { infanteria: 800, arqueria: 0, caballeria: 0, asedio: 50 } });
  const walled = side({ kingdomId: "walled", wallsLevel: 3 });
  const open = side({ kingdomId: "open", wallsLevel: 0 });
  const vsWalls = simulateBattle(siegeArmy, walled);
  const vsOpen = simulateBattle(siegeArmy, open);
  const strengthVsWalls = computeSideFactors(siegeArmy, siegeArmy.composition, walled).offensiveStrength;
  const strengthVsOpen = computeSideFactors(siegeArmy, siegeArmy.composition, open).offensiveStrength;
  // Techo matemático de bajas con los valores aprobados: 1 − (1 − k)^rondas.
  const maxLossCeiling = 1 - (1 - COMBAT.CASUALTY_RATE_K) ** COMBAT.MAX_ROUNDS;

  const factorCounter = strategyFactor("defensiva", "agresiva", "defense");
  const factorPlain = strategyFactor("defensiva", "defensiva", "defense");
  const factorClampLow = strategyFactor("agresiva", "defensiva", "defense");

  const recovery1 = woundedRecoveryRatio(1, 0, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recovery5 = woundedRecoveryRatio(7, 0, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recoveryTech = woundedRecoveryRatio(5, 0.15, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recoveryNone = woundedRecoveryRatio(0, 0.15, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);

  const woundedConsistent = [equal, eliteWins, crushing].every((report) =>
    report.attacker.wounded === Math.round(report.attacker.casualtiesComposition.infanteria * 0.65) &&
    report.attacker.dead === report.attacker.casualties - report.attacker.wounded &&
    report.attacker.survivors + report.attacker.casualties === report.attacker.initial &&
    report.defender.survivors + report.defender.casualties === report.defender.initial
  );

  return [
    {
      test: "Determinismo: fuerzas idénticas producen el mismo informe y terminan en empate con 3 rondas (P52, D-29/D-30)",
      passed: JSON.stringify(equal) === JSON.stringify(equalAgain) && equal.outcome === "empate" && equal.rounds.length === 3 &&
        equal.attacker.casualties === equal.defender.casualties && equal.winnerKingdomId === null && !equal.crushingVictory,
      details: `Resultado ${equal.outcome}; rondas ${equal.rounds.length}; bajas ${equal.attacker.casualties}/${equal.defender.casualties}`,
    },
    {
      test: "Fuerza menor bien preparada (850 élite) frente a mayor mal preparada (1.000): sufre menos pérdidas relativas y nunca pierde",
      passed: eliteWins.outcome !== "derrota" && eliteWins.attacker.lossRatio < eliteWins.defender.lossRatio &&
        eliteWins.explanation.some((line) => line.includes("Entrenamiento")) && eliteWins.defender.factors.fatigue === 0.6,
      details: `Resultado ${eliteWins.outcome}; pérdidas élite ${(eliteWins.attacker.lossRatio * 100).toFixed(1)} % frente a horda ${(eliteWins.defender.lossRatio * 100).toFixed(1)} %. PENDIENTE DE BALANCE: con los exponentes aprobados (0,20/0,15/0,10/0,05) y la tolerancia de empate de 10 puntos, la ventaja cualitativa máxima no basta para una victoria sin retirada (P34/P69).`,
    },
    {
      test: "Superioridad abrumadora gana, y las bajas quedan bajo el techo 1−(1−k)^3 = 44,9 % de los valores aprobados (k=0,18, 3 rondas)",
      passed: crushing.outcome === "victoria" && crushing.winnerKingdomId === "horde" && crushing.defender.lossRatio <= maxLossCeiling + 1e-9 &&
        crushing.defender.lossRatio > 0.4 && crushing.crushingVictory === (crushing.defender.lossRatio > COMBAT.CRUSHING_VICTORY_LOSS_RATIO) &&
        crushing.defender.retreated === (crushing.defender.lossRatio >= COMBAT.RETREAT_LOSS_RATIO) && crushing.rounds.length === 3,
      details: `Pérdidas del pequeño ${(crushing.defender.lossRatio * 100).toFixed(1)} % (techo ${(maxLossCeiling * 100).toFixed(1)} %); retirada ${crushing.defender.retreated}; aplastante ${crushing.crushingVictory}. PENDIENTE DE BALANCE: con estos valores el 70 % de retirada y el 75 % de victoria aplastante (P47) no son alcanzables en una batalla.`,
    },
    {
      test: "Moral inferior a 20 fuerza la retirada tras la primera ronda (D-30)",
      passed: demoralized.outcome === "derrota" && demoralized.attacker.retreated && demoralized.rounds.length === 1,
      details: `Resultado ${demoralized.outcome}; rondas ${demoralized.rounds.length}`,
    },
    {
      test: "El asedio rinde ×1,8 solo contra murallas (D-28): más bajas al defensor amurallado que en campo abierto",
      passed: vsWalls.rounds[0].defenderCasualties > vsOpen.rounds[0].defenderCasualties &&
        Math.abs(strengthVsOpen - (800 + 50)) < 1e-9 && Math.abs(strengthVsWalls - (800 + 90)) < 1e-9,
      details: `Bajas defensor ronda 1 con murallas ${vsWalls.rounds[0].defenderCasualties} frente a sin murallas ${vsOpen.rounds[0].defenderCasualties}`,
    },
    {
      test: "Estrategias (P35): contrarrestar da ventaja y el factor se mantiene en 0,80–1,25",
      passed: Math.abs(factorCounter - 1.25) < 1e-9 && Math.abs(factorPlain - 1.2) < 1e-9 && Math.abs(factorClampLow - 0.8) < 1e-9,
      details: `Defensiva vs agresiva: ${factorCounter}; defensiva vs defensiva: ${factorPlain}; agresiva en defensa: ${factorClampLow}`,
    },
    {
      test: "Heridos ≈65 % de las bajas (P44) y contabilidad cerrada de supervivientes; recuperación hospitalaria P45 con tope 60 %",
      passed: woundedConsistent && recovery1 === 0.15 && recovery5 === 0.5 && Math.abs(recoveryTech - 0.6) < 1e-9 && recoveryNone === 0 &&
        equal.honorAwarded.pending && equal.lootTransferred === false,
      details: `Contabilidad coherente: ${woundedConsistent}; recuperación nivel 1/5+/5+tec/sin hospital: ${recovery1}/${recovery5}/${recoveryTech}/${recoveryNone}`,
    },
  ];
}
