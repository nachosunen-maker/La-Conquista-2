import { applyFormation, calculateEquipmentWear, calculateHospitalRecovery, computeSideFactors, emptyComposition, simulateBattle, strategyFactor, tacticalCounterMultiplier, tacticalFormationFactor, wallsDefenseBonus, woundedRecoveryRatio, type BattleSide, type Composition } from "./battleRules";
import { BATTLE_REWARDS, COMBAT, HOSPITAL, HOSPITAL_RECOVERY_CAP, HOSPITAL_RECOVERY_PER_YEAR, TACTICAL_FORMATIONS, TACTICAL_FORMATION_COUNTER_BONUS, type TacticalFormation } from "./balanceConfig";

export interface BattleTestResult {
  test: string;
  passed: boolean;
  details: string;
}

function side(overrides: Partial<BattleSide> & { kingdomId: string }): BattleSide {
  const { composition, ...rest } = overrides;
  return {
    trainingMultiplier: 1,
    weaponTier: "espadaHierro",
    armorTier: "cueroReforzado",
    strategy: "concentracion",
    morale: 70,
    foodTier: "normal",
    fatigue: 0,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    ...rest,
    name: overrides.kingdomId,
    composition: { ...emptyComposition(), ...(composition ?? { infanteria: 1000 }) },
  };
}

export function runBattleValidationTests(): BattleTestResult[] {
  const equal = simulateBattle(side({ kingdomId: "A" }), side({ kingdomId: "B" }));
  const equalAgain = simulateBattle(side({ kingdomId: "A" }), side({ kingdomId: "B" }));

  // Fuerza pequeña bien preparada contra fuerza grande mal preparada (P34, P69)
  const elite = side({ kingdomId: "elite", composition: { ...emptyComposition(), infanteria: 600 }, trainingMultiplier: 1.9, weaponTier: "aceroAvanzado", armorTier: "acero", morale: 95, foodTier: "excelente", strategy: "agresiva" });
  const mob = side({ kingdomId: "mob", composition: { ...emptyComposition(), infanteria: 1000 }, trainingMultiplier: 1, weaponTier: "palo", armorTier: "ninguna", morale: 30, foodTier: "minima", fatigue: 80, strategy: "concentracion" });
  const eliteWins = simulateBattle(elite, mob);

  // Superioridad numérica abrumadora
  const horde = side({ kingdomId: "horde", composition: { ...emptyComposition(), infanteria: 5000 } });
  const small = side({ kingdomId: "small", composition: { ...emptyComposition(), infanteria: 300 } });
  const crushing = simulateBattle(horde, small);

  // Moral baja fuerza la retirada
  const demoralized = simulateBattle(side({ kingdomId: "low", morale: 10 }), side({ kingdomId: "ok" }));

  // Asedio contra murallas y sin murallas
  const siegeArmy = side({ kingdomId: "siege", composition: { ...emptyComposition(), infanteria: 800, asedio: 50 } });
  const walled = side({ kingdomId: "walled", wallsLevel: 3 });
  const open = side({ kingdomId: "open", wallsLevel: 0 });
  const strengthVsWalls = computeSideFactors(siegeArmy, siegeArmy.composition, walled).offensiveStrength;
  const strengthVsOpen = computeSideFactors(siegeArmy, siegeArmy.composition, open).offensiveStrength;
  const wallsFactors = computeSideFactors(side({ kingdomId: "w", wallsLevel: 10 }), { ...emptyComposition(), infanteria: 1000 }, open);
  const noWallsFactors = computeSideFactors(side({ kingdomId: "w", wallsLevel: 0 }), { ...emptyComposition(), infanteria: 1000 }, open);
  const maxLossCeiling = 1 - (1 - COMBAT.CASUALTY_RATE_K) ** COMBAT.MAX_ROUNDS;

  // Matriz de contrapartidas P37 (M-11)
  const cavalry = side({ kingdomId: "cav", composition: { ...emptyComposition(), caballeria: 1000 } });
  const archers = side({ kingdomId: "arc", composition: { ...emptyComposition(), arqueria: 1000 } });
  const infantry = side({ kingdomId: "inf" });
  const cavVsArchers = computeSideFactors(cavalry, cavalry.composition, archers).offensiveStrength;
  const cavVsInfantry = computeSideFactors(cavalry, cavalry.composition, infantry).offensiveStrength;
  const formed = applyFormation({ ...emptyComposition(), infanteria: 1000, arqueria: 400, caballeria: 200, asedio: 10 }, { arqueria: 0.5, caballeria: 0 });

  const factorCounter = strategyFactor("defensiva", "agresiva", "defense");
  const factorPlain = strategyFactor("defensiva", "defensiva", "defense");
  const factorClampLow = strategyFactor("agresiva", "defensiva", "defense");

  // Formaciones tácticas (decisión 21-10-2026)
  const tacticalIds = Object.keys(TACTICAL_FORMATIONS) as TacticalFormation[];
  const cycleClosed = tacticalIds.every((id) => {
    const beats = TACTICAL_FORMATIONS[id].beats;
    return beats === null || TACTICAL_FORMATIONS[beats].beats !== id;
  }) && tacticalIds.filter((id) => TACTICAL_FORMATIONS[id].beats !== null).length === 3 && TACTICAL_FORMATIONS.equilibrada.beats === null;
  const tacticalCounter = tacticalCounterMultiplier("ofensiva", "flanqueo");
  const tacticalNoCounter = tacticalCounterMultiplier("ofensiva", "defensiva");
  const tacticalPlain = tacticalFormationFactor("ofensiva", "ofensiva", "attack");
  const tacticalBalanced = tacticalFormationFactor("equilibrada", "ofensiva", "attack");
  const tacticalWins = tacticalIds.filter((id) => TACTICAL_FORMATIONS[id].beats !== null).every((id) => {
    const report = simulateBattle(side({ kingdomId: "A", tacticalFormation: id }), side({ kingdomId: "B", tacticalFormation: TACTICAL_FORMATIONS[id].beats! }));
    return report.outcome === "victoria" && !report.crushingVictory && report.defender.lossRatio - report.attacker.lossRatio > COMBAT.DRAW_TOLERANCE;
  });
  const noCounterDraws = tacticalIds.every((a) => tacticalIds.every((d) => {
    if (TACTICAL_FORMATIONS[a].beats === d || TACTICAL_FORMATIONS[d].beats === a) return true;
    return simulateBattle(side({ kingdomId: "A", tacticalFormation: a }), side({ kingdomId: "B", tacticalFormation: d })).outcome === "empate";
  }));
  const balancedNeverCrushed = tacticalIds.every((id) => {
    const report = simulateBattle(side({ kingdomId: "A", tacticalFormation: id }), side({ kingdomId: "B", tacticalFormation: "equilibrada" }));
    return !report.crushingVictory && report.defender.lossRatio < 0.6;
  });
  const defaultIsBalanced = computeSideFactors(side({ kingdomId: "x" }), { ...emptyComposition(), infanteria: 1000 }, side({ kingdomId: "y" })).tacticalFormation === "equilibrada";

  const recovery1 = woundedRecoveryRatio(1, 0, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recovery5 = woundedRecoveryRatio(7, 0, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recoveryTech = woundedRecoveryRatio(5, 0.15, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);
  const recoveryNone = woundedRecoveryRatio(0, 0.15, HOSPITAL_RECOVERY_PER_YEAR, HOSPITAL_RECOVERY_CAP);

  const wearSample = calculateEquipmentWear(0.25);
  const hospCalc = calculateHospitalRecovery({
    hospitalLevel: 2,
    totalWounded: 250,
    elapsedDays: 1,
  });
  const hospOk = hospCalc.hospitalCapacity === 200 && hospCalc.hospitalizedWounded === 200 && hospCalc.overflowWounded === 50 && hospCalc.recoveredCount === 46;

  const woundedConsistent = [equal, eliteWins, crushing].every((report) =>
    report.attacker.wounded === Math.round(report.attacker.casualtiesComposition.infanteria * 0.65) &&
    report.attacker.dead === report.attacker.casualties - report.attacker.wounded &&
    report.attacker.survivors + report.attacker.casualties === report.attacker.initial &&
    report.defender.survivors + report.defender.casualties === report.defender.initial
  );

  // 10. Batería de 16 combinaciones y simulaciones obligatorias de formaciones tácticas
  const matrix16Results: { pair: string; outcome: string; crushing: boolean; lossA: number; lossD: number }[] = [];
  let matrix16Deterministic = true;
  for (const a of tacticalIds) {
    for (const d of tacticalIds) {
      const rep1 = simulateBattle(side({ kingdomId: "A", tacticalFormation: a }), side({ kingdomId: "B", tacticalFormation: d }));
      const rep2 = simulateBattle(side({ kingdomId: "A", tacticalFormation: a }), side({ kingdomId: "B", tacticalFormation: d }));
      if (JSON.stringify(rep1) !== JSON.stringify(rep2)) {
        matrix16Deterministic = false;
      }
      matrix16Results.push({
        pair: `${a} vs ${d}`,
        outcome: rep1.outcome,
        crushing: rep1.crushingVictory,
        lossA: rep1.attacker.lossRatio,
        lossD: rep1.defender.lossRatio,
      });
    }
  }

  const totalCombos = matrix16Results.length;
  const crushingCount = matrix16Results.filter((r) => r.crushing).length;
  const winCount = matrix16Results.filter((r) => r.outcome === "victoria").length;
  const lossCount = matrix16Results.filter((r) => r.outcome === "derrota").length;
  const drawCount = matrix16Results.filter((r) => r.outcome === "empate").length;

  // Ejército desigual: 2.000 (defensiva) vs 1.000 (flanqueo). Flanqueo contrarresta defensiva, pero 2.000 gana por masa
  const bigVsCounter = simulateBattle(
    side({ kingdomId: "A", composition: { ...emptyComposition(), infanteria: 2000 }, tacticalFormation: "defensiva" }),
    side({ kingdomId: "B", composition: { ...emptyComposition(), infanteria: 1000 }, tacticalFormation: "flanqueo" })
  );
  const bigArmyWins = bigVsCounter.outcome === "victoria" && !bigVsCounter.crushingVictory && bigVsCounter.attacker.lossRatio < bigVsCounter.defender.lossRatio;

  // Interacción con fatiga y moral: atacante con contramedida pero fatiga 70 y moral 50 vs defensor descansado (fatiga 0, moral 80)
  const fatigueInteraction = simulateBattle(
    side({ kingdomId: "A", tacticalFormation: "ofensiva", fatigue: 70, morale: 50 }),
    side({ kingdomId: "B", tacticalFormation: "flanqueo", fatigue: 0, morale: 80 })
  );
  const fatigueRestrained = fatigueInteraction.outcome === "empate" || fatigueInteraction.outcome === "derrota";

  return [
    {
      test: "Determinismo: fuerzas idénticas producen el mismo informe y terminan en empate con 3 rondas (P52, D-29/D-30)",
      passed: JSON.stringify(equal) === JSON.stringify(equalAgain) && equal.outcome === "empate" && equal.rounds.length === 3 &&
        equal.attacker.casualties === equal.defender.casualties && equal.winnerKingdomId === null && !equal.crushingVictory &&
        equal.honorAwarded.attacker === BATTLE_REWARDS.draw.honor && !equal.honorAwarded.pending,
      details: `Resultado ${equal.outcome}; rondas ${equal.rounds.length}; bajas ${equal.attacker.casualties}/${equal.defender.casualties}; honor por empate ${equal.honorAwarded.attacker}`,
    },
    {
      test: "B-02: 600 soldados de élite derrotan a 1.000 reclutas mal preparados (P34, P69)",
      passed: eliteWins.outcome === "victoria" && eliteWins.winnerKingdomId === "elite" && eliteWins.defender.lossRatio > eliteWins.attacker.lossRatio &&
        eliteWins.explanation.some((line) => line.includes("Entrenamiento")) && eliteWins.defender.factors.fatigue === 0.6 &&
        eliteWins.honorAwarded.attacker >= BATTLE_REWARDS.victory.honor && eliteWins.gloryAwarded.defender === BATTLE_REWARDS.defeat.glory,
      details: `Resultado ${eliteWins.outcome}; pérdidas élite ${(eliteWins.attacker.lossRatio * 100).toFixed(1)} % frente a reclutas ${(eliteWins.defender.lossRatio * 100).toFixed(1)} %; honor ${eliteWins.honorAwarded.attacker}/${eliteWins.honorAwarded.defender}`,
    },
    {
      test: "B-01: con k = 0,40 la superioridad abrumadora fuerza la retirada (70 %) y es victoria aplastante (>75 %, P47) con +50 honor",
      passed: crushing.outcome === "victoria" && crushing.defender.retreated && crushing.defender.lossRatio > COMBAT.CRUSHING_VICTORY_LOSS_RATIO &&
        crushing.crushingVictory && crushing.defender.lossRatio <= maxLossCeiling + 1e-9 &&
        crushing.honorAwarded.attacker === BATTLE_REWARDS.crushingVictory.honor && crushing.gloryAwarded.attacker === BATTLE_REWARDS.crushingVictory.glory,
      details: `Pérdidas del pequeño ${(crushing.defender.lossRatio * 100).toFixed(1)} % (techo ${(maxLossCeiling * 100).toFixed(1)} %); retirada ${crushing.defender.retreated}; aplastante ${crushing.crushingVictory}; rondas ${crushing.rounds.length}`,
    },
    {
      test: "Moral inferior a 20 fuerza la retirada tras la primera ronda (D-30)",
      passed: demoralized.outcome === "derrota" && demoralized.attacker.retreated && demoralized.rounds.length === 1,
      details: `Resultado ${demoralized.outcome}; rondas ${demoralized.rounds.length}`,
    },
    {
      test: "Murallas (M-06): el asedio rinde ×1,8 solo contra murallas y la defensa sube +5 %/nivel hasta +50 %",
      passed: Math.abs(strengthVsOpen - (800 + 50)) < 1e-9 && Math.abs(strengthVsWalls - (800 + 90)) < 1e-9 &&
        Math.abs(wallsDefenseBonus(3) - 0.15) < 1e-9 && Math.abs(wallsDefenseBonus(20) - 0.5) < 1e-9 && wallsFactors.defensivePower > noWallsFactors.defensivePower &&
        Math.abs(wallsFactors.defensivePower / noWallsFactors.defensivePower - 1.5 ** COMBAT.EXPONENTS.number) < 1e-9,
      details: `Fuerza de asedio sin/con murallas: ${strengthVsOpen}/${strengthVsWalls}; defensa con murallas 10 frente a 0: ×${(wallsFactors.defensivePower / noWallsFactors.defensivePower).toFixed(3)}`,
    },
    {
      test: "Formación (P37, M-11): la caballería gana +25 % contra arqueros y nada contra infantería; la fracción de participación se aplica por tipo",
      passed: Math.abs(cavVsArchers - 1000 * 1.4 * 1.25) < 1e-9 && Math.abs(cavVsInfantry - 1000 * 1.4) < 1e-9 &&
        formed.infanteria === 1000 && formed.arqueria === 200 && formed.caballeria === 0 && formed.asedio === 10,
      details: `Caballería vs arqueros ${cavVsArchers}; vs infantería ${cavVsInfantry}; formación ${JSON.stringify(formed)}`,
    },
    {
      test: "Estrategias (P35): contrarrestar da ventaja y el factor se mantiene en 0,80–1,25",
      passed: Math.abs(factorCounter - 1.25) < 1e-9 && Math.abs(factorPlain - 1.2) < 1e-9 && Math.abs(factorClampLow - 0.8) < 1e-9,
      details: `Defensiva vs agresiva: ${factorCounter}; defensiva vs defensiva: ${factorPlain}; agresiva en defensa: ${factorClampLow}`,
    },
    {
      test: `Formaciones tácticas (decisión 21-10-2026): ciclo ofensiva > flanqueo > defensiva > ofensiva, equilibrada neutral, contramedida ×${TACTICAL_FORMATION_COUNTER_BONUS}; con ejércitos iguales contrarrestar gana sin aplastar y el resto empata`,
      passed: cycleClosed && Math.abs(tacticalCounter - TACTICAL_FORMATION_COUNTER_BONUS) < 1e-9 && tacticalNoCounter === 1 && Math.abs(tacticalPlain - 1.12) < 1e-9 && tacticalBalanced === 1 &&
        tacticalWins && noCounterDraws && balancedNeverCrushed && defaultIsBalanced,
      details: `Ciclo cerrado: ${cycleClosed}; contramedida ofensiva vs flanqueo ×${tacticalCounter}, vs defensiva ×${tacticalNoCounter}; factor ofensiva ${tacticalPlain}; equilibrada ${tacticalBalanced}; contrarrestar vence sin aplastar: ${tacticalWins}; sin contramedida empata: ${noCounterDraws}; equilibrada nunca aplastada: ${balancedNeverCrushed}; por defecto equilibrada: ${defaultIsBalanced}`,
    },
    {
      test: "Heridos ≈65 % de las bajas (P44) y contabilidad cerrada de supervivientes; recuperación hospitalaria P45 con tope 60 % y desgaste de equipamiento",
      passed: woundedConsistent && recovery1 === 0.15 && recovery5 === 0.5 && Math.abs(recoveryTech - 0.6) < 1e-9 && recoveryNone === 0 &&
        equal.lootTransferred === false && wearSample === 25 && hospOk,
      details: `Contabilidad coherente: ${woundedConsistent}; recuperación nivel 1/5+/5+tec/sin hospital: ${recovery1}/${recovery5}/${recoveryTech}/${recoveryNone}; hospital cap/heridos/recuperados: ${hospCalc.hospitalCapacity}/${hospCalc.hospitalizedWounded}/${hospCalc.recoveredCount}; desgaste: ${wearSample} %`,
    },
    {
      test: "Simulaciones obligatorias de formaciones tácticas: matriz 16 combinaciones (3 victorias, 3 derrotas, 10 empates sin aplastantes), superioridad 2:1 preservada frente a contramedida, modulación por fatiga/moral y determinismo",
      passed: totalCombos === 16 && crushingCount === 0 && winCount === 3 && lossCount === 3 && drawCount === 10 &&
        matrix16Deterministic && bigArmyWins && fatigueRestrained,
      details: `Matriz 16: ${totalCombos} pares (victorias: ${winCount}, derrotas: ${lossCount}, empates: ${drawCount}, aplastantes: ${crushingCount}); determinismo 100%: ${matrix16Deterministic}; 2.000 vs 1.000 con contramedida gana grande: ${bigArmyWins}; fatiga/moral modulan ventaja: ${fatigueRestrained}`,
    },
  ];
}
