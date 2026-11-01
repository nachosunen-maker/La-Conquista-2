/**
 * LA CONQUISTA — PRUEBAS PURAS DEL SISTEMA DE BOTS MILITARES (Bloques E y F)
 * Valida catálogo canónico de 47 monarcas, dificultades fijas, rotación semanal de 7 días,
 * inmutabilidad de plantillas militares y márgenes de error de espionaje.
 */

import {
  BOT_DIFFICULTY_LABELS,
  BOT_DIFFICULTY_LEVELS,
  BOT_ROTATION_INTERVAL_MS,
  PERMANENT_BOTS,
  ROTATING_POOLS,
  getAllActiveBots,
  getBotById,
  getRotatingBots,
  getRotationCycle,
  type BotDifficulty,
} from "./botConfig";
import {
  createBotBattleSide,
  estimateBotArmy,
  totalBotPersonnel,
  totalBotMachines,
  totalBotUnits,
} from "./botRules";
import { simulateBattle, type BattleSide } from "./battleRules";

export function runBotPureTests(): { passed: number; failed: number; errors: string[] } {
  const errors: string[] = [];
  let passed = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      errors.push(msg);
    } else {
      passed++;
    }
  }

  // 1. Catálogo canónico: 47 monarcas únicos
  const allIds = new Set<string>();
  const allMonarchNames = new Set<string>();
  let totalBotsCount = 0;

  for (const bot of PERMANENT_BOTS) {
    assert(!allIds.has(bot.id), `ID duplicado en permanentes: ${bot.id}`);
    allIds.add(bot.id);
    allMonarchNames.add(bot.monarchName);
    totalBotsCount++;
  }

  const difficulties: BotDifficulty[] = ["facil", "media", "dificil", "muy_dificil", "extrema"];

  for (const diff of difficulties) {
    const pool = ROTATING_POOLS[diff];
    assert(pool && pool.length > 0, `El pool de rotación para dificultad "${diff}" no debe estar vacío.`);
    for (const bot of pool) {
      assert(!allIds.has(bot.id), `ID duplicado en rotatorios: ${bot.id}`);
      allIds.add(bot.id);
      allMonarchNames.add(bot.monarchName);
      totalBotsCount++;
    }
  }

  assert(totalBotsCount === 47, `El catálogo debe contener exactamente 47 monarcas canónicos (actual: ${totalBotsCount}).`);
  assert(allIds.size === 47, `Debe haber 47 IDs únicos.`);
  assert(allMonarchNames.size === 47, `Debe haber 47 monarcas históricos con nombres únicos.`);

  // 2. Composición de los 5 bots permanentes
  assert(PERMANENT_BOTS.length === 5, `Debe haber exactamente 5 bots permanentes.`);
  const permDiffs = PERMANENT_BOTS.map((b) => b.difficulty);
  for (const diff of difficulties) {
    assert(permDiffs.includes(diff), `Debe existir un bot permanente con dificultad ${diff}.`);
  }

  const narbona = getBotById("bot_perm_narbona");
  assert(narbona !== null && narbona.monarchName === "Narbona", `Narbona debe existir como bot permanente.`);
  assert(narbona?.difficulty === "facil", `Narbona debe tener dificultad Fácil.`);
  assert(narbona?.civilization === "navajos", `Narbona debe ser de civilización Navajos.`);
  assert(narbona?.army.composition.caballeria === 0, `Navajos no tienen caballería (0 jinetes).`);

  const alfredo = getBotById("bot_perm_alfredo");
  assert(alfredo !== null && alfredo.difficulty === "media", `Alfredo el Grande debe ser Media.`);

  const leonidas = getBotById("bot_perm_leonidas");
  assert(leonidas !== null && leonidas.difficulty === "dificil", `Leónidas I debe ser Difícil.`);

  const saladino = getBotById("bot_perm_saladino");
  assert(saladino !== null && saladino.difficulty === "muy_dificil", `Saladino debe ser Muy difícil.`);

  const cesar = getBotById("bot_perm_julio_cesar");
  assert(cesar !== null && cesar.difficulty === "extrema", `Julio César debe ser Extrema.`);

  // 3. Modulación cultural de ejércitos
  const aztecaBot = getBotById("bot_rot_itzcoatl");
  assert(aztecaBot !== null && aztecaBot.army.composition.caballeria === 0, `Aztecas deben tener 0 caballería.`);

  const masaiBot = getBotById("bot_rot_senteu");
  assert(masaiBot !== null && masaiBot.army.composition.caballeria === 0, `Masáis deben tener 0 caballería.`);

  // 4. Rotación semanal determinista de 7 días
  const now = 1730000000000; // Timestamp de prueba
  const cycle = getRotationCycle(now);
  assert(cycle.cycleExpiresAtMs > now, `El ciclo debe expirar en el futuro.`);
  assert(cycle.cycleExpiresAtMs - cycle.cycleStartMs === BOT_ROTATION_INTERVAL_MS, `El ciclo debe durar 7 días exactos.`);

  const rotating1 = getRotatingBots(now);
  assert(rotating1.length === 5, `Siempre debe haber exactamente 5 bots rotatorios activos.`);
  const rotatingDiffs = rotating1.map((b) => b.difficulty);
  for (const diff of difficulties) {
    assert(rotatingDiffs.includes(diff), `La rotación debe incluir un bot de dificultad ${diff}.`);
  }

  // Idempotencia dentro del mismo ciclo
  const rotatingSameCycle = getRotatingBots(now + 1000 * 60 * 60 * 24); // +1 día
  assert(
    rotating1.map((b) => b.id).join(",") === rotatingSameCycle.map((b) => b.id).join(","),
    `Dentro de los mismos 7 días la rotación debe devolver exactamente los mismos bots.`
  );

  // Cambio de ciclo tras 7 días
  const rotatingNextCycle = getRotatingBots(now + BOT_ROTATION_INTERVAL_MS);
  assert(
    rotating1.map((b) => b.id).join(",") !== rotatingNextCycle.map((b) => b.id).join(","),
    `Al avanzar 7 días reales debe rotar a un nuevo conjunto de monarcas.`
  );

  // Total activos: 5 permanentes + 5 rotatorios = 10 bots
  const allActive = getAllActiveBots(now);
  assert(allActive.length === 10, `getAllActiveBots debe devolver exactamente 10 bots militares.`);

  // 5. Espionaje canónico
  const testBot = cesar!;
  const est0 = estimateBotArmy(testBot, 0);
  assert(est0.level === 0 && est0.errorRatio === 0.25, `Nivel 0 debe tener margen ±25 %`);

  const est1 = estimateBotArmy(testBot, 1);
  assert(est1.level === 1 && est1.errorRatio === 0.15, `Nivel 1 debe tener margen ±15 %`);

  const est2 = estimateBotArmy(testBot, 2);
  assert(est2.level === 2 && est2.errorRatio === 0.07, `Nivel 2 debe tener margen ±7 %`);

  const totalRealUnits = totalBotUnits(testBot.army.composition);
  assert(est0.total.min <= totalRealUnits && totalRealUnits <= est0.total.max, `Estimación N0 debe contener el total real.`);
  assert(est1.total.min <= totalRealUnits && totalRealUnits <= est1.total.max, `Estimación N1 debe contener el total real.`);
  assert(est2.total.min <= totalRealUnits && totalRealUnits <= est2.total.max, `Estimación N2 debe contener el total real.`);

  // 6. Inmutabilidad de la plantilla del bot en simulación de batalla
  const botSide = createBotBattleSide(testBot);
  const initialBotInfantry = testBot.army.composition.infanteria;

  const playerSideComp = { ...testBot.army.composition };
  playerSideComp.infanteria = 500;
  playerSideComp.arqueria = 300;
  playerSideComp.caballeria = 200;
  playerSideComp.asedio = 50;

  const playerSide: BattleSide = {
    kingdomId: "player_test",
    name: "Hueste Real de Prueba",
    composition: playerSideComp,
    trainingMultiplier: 1.5,
    weaponTier: "acero",
    armorTier: "hierro",
    strategy: "agresiva",
    tacticalFormation: "ofensiva",
    morale: 80,
    foodTier: "abundante",
    fatigue: 0,
    wallsLevel: 0,
    terrainDefenseBonus: 0,
    civilization: "romanos",
  };

  const battleReport = simulateBattle(playerSide, botSide);
  assert(typeof battleReport.outcome === "string", `El simulador debe devolver un resultado de combate.`);
  assert(battleReport.attacker.dead >= 0, `Las bajas del atacante deben ser no negativas.`);
  assert(battleReport.defender.dead >= 0, `Las bajas del defensor deben ser no negativas.`);

  // Verificar que la configuración original del bot NO se alteró
  assert(
    testBot.army.composition.infanteria === initialBotInfantry,
    `La plantilla del bot debe ser inmutable y permanecer inalterada tras la batalla.`
  );

  return { passed, failed: errors.length, errors };
}
