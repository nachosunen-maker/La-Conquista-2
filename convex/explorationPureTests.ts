/**
 * LA CONQUISTA — PRUEBAS PURAS DE EXPLORACIÓN Y NIEBLA DE GUERRA (P22, P49)
 * Valida visibilidad, adyacencia de frontera, costes, tiempos de marcha,
 * reservas de exploradores, reembolsos y descubrimientos deterministas.
 */
import { EXPLORATION, MAP } from "./balanceConfig";
import {
  calculateExplorationRefund,
  canStartExploration,
  explorationProgress,
  filterDiscoveredKingdoms,
  generateExplorationDiscovery,
  getInitialSightCellIds,
  isKingdomDiscoveredOnMap,
} from "./explorationRules";
import { canClaimTerritory, generateWorldCells, hexDistance } from "./territoryRules";

export interface ExplorationTestResult {
  category: string;
  test: string;
  passed: boolean;
  details: string;
}

export function runExplorationValidationTests(): ExplorationTestResult[] {
  const world = generateWorldCells();
  const homeCoord = { q: 0, r: 0 };
  const homeCellId = "0,0";

  // 1. Visión inicial
  const initialSight = getInitialSightCellIds(homeCoord);
  const initialSightSet = new Set(initialSight);

  // 2. Celdas adyacentes y lejanas
  const adjacentTarget = { q: 1, r: 1 }; // Vecino de (0,1) o (1,0)
  const adjacentTargetId = "1,1";
  const farTarget = { q: 5, r: -2 };
  const farTargetId = "5,-2";

  // 3. Validación de exploración en celda adyacente válida
  const validCheck = canStartExploration({
    targetCoord: adjacentTarget,
    targetCellId: adjacentTargetId,
    knownCellIds: initialSightSet,
    activeCellIds: new Set(),
    ownedCoords: [homeCoord],
    availableCivil: 10,
    currentResources: { gold: 200, food: 300 },
    activeExpeditionsCount: 0,
  });

  // 4. Rechazo por falta de adyacencia (salto en niebla profunda)
  const farCheck = canStartExploration({
    targetCoord: farTarget,
    targetCellId: farTargetId,
    knownCellIds: initialSightSet,
    activeCellIds: new Set(),
    ownedCoords: [homeCoord],
    availableCivil: 10,
    currentResources: { gold: 200, food: 300 },
    activeExpeditionsCount: 0,
  });

  // 5. Rechazo por recursos insuficientes
  const poorCheck = canStartExploration({
    targetCoord: adjacentTarget,
    targetCellId: adjacentTargetId,
    knownCellIds: initialSightSet,
    activeCellIds: new Set(),
    ownedCoords: [homeCoord],
    availableCivil: 10,
    currentResources: { gold: 10, food: 10 },
    activeExpeditionsCount: 0,
  });

  // 6. Rechazo por falta de ciudadanos libres (scouts)
  const noScoutCheck = canStartExploration({
    targetCoord: adjacentTarget,
    targetCellId: adjacentTargetId,
    knownCellIds: initialSightSet,
    activeCellIds: new Set(),
    ownedCoords: [homeCoord],
    availableCivil: 0,
    currentResources: { gold: 100, food: 100 },
    activeExpeditionsCount: 0,
  });

  // 7. Rechazo por límite de expediciones activas
  const busyCheck = canStartExploration({
    targetCoord: adjacentTarget,
    targetCellId: adjacentTargetId,
    knownCellIds: initialSightSet,
    activeCellIds: new Set(),
    ownedCoords: [homeCoord],
    availableCivil: 5,
    currentResources: { gold: 100, food: 100 },
    activeExpeditionsCount: 1,
  });

  // 8. Progreso temporal
  const t0 = 10000;
  const dur = 1800000; // 1800s en ms
  const pStart = explorationProgress(t0, dur, t0);
  const pMid = explorationProgress(t0, dur, t0 + dur / 2);
  const pDone = explorationProgress(t0, dur, t0 + dur);
  const pPast = explorationProgress(t0, dur, t0 + dur + 5000);

  // 9. Reembolso del 50 %
  const refund = calculateExplorationRefund({ gold: 30, food: 40 });

  // 10. Descubrimientos deterministas
  const sampleCell = world.find((c) => c.terrain === "bosque") ?? world[1];
  const discovery = generateExplorationDiscovery(sampleCell, null);

  // 11. Integración de reclamación de territorios con exploración (P49)
  const unexploredTarget = world.find((c) => hexDistance(c, homeCoord) === 1)!;
  const claimUnexplored = canClaimTerritory({
    target: { ...unexploredTarget, ownerKingdomId: null },
    ownedCells: [homeCoord],
    pendingClaims: 1,
    exploredCellIds: new Set([homeCellId]), // No incluye la celda objetivo
  });
  const claimExplored = canClaimTerritory({
    target: { ...unexploredTarget, ownerKingdomId: null },
    ownedCells: [homeCoord],
    pendingClaims: 1,
    exploredCellIds: new Set([homeCellId, unexploredTarget.cellId]),
  });

  return [
    {
      category: "VISIBILIDAD INICIAL P22",
      test: "1. Radio de visión inicial alrededor de la capital cubre exactamente 7 celdas conocidas",
      passed: initialSight.length === 7 && initialSightSet.has(homeCellId),
      details: `Celdas conocidas iniciales: ${initialSight.length} (${initialSight.join(", ")})`,
    },
    {
      category: "EXPANSIÓN Y ADYACENCIA P22",
      test: "2. Permite explorar celdas adyacentes a la frontera y bloquea celdas no limítrofes",
      passed: validCheck.success && !farCheck.success,
      details: `Adyacente aprobada: ${validCheck.success}; Lejana bloqueada: ${!farCheck.success}`,
    },
    {
      category: "COSTES Y DURACIÓN CANÓNICA D-26",
      test: "3. Aplica costes base (30 oro, 40 comida) y duración canónica de marcha (1.800 s/hex)",
      passed: validCheck.success &&
        validCheck.plan.costs.gold === EXPLORATION.BASE_COSTS.gold &&
        validCheck.plan.costs.food === EXPLORATION.BASE_COSTS.food &&
        validCheck.plan.distance === 2 &&
        validCheck.plan.durationSeconds === 3600,
      details: `Oro: ${validCheck.success ? validCheck.plan.costs.gold : 0}, Comida: ${validCheck.success ? validCheck.plan.costs.food : 0}, Distancia: ${validCheck.success ? validCheck.plan.distance : 0}, Segundos: ${validCheck.success ? validCheck.plan.durationSeconds : 0}`,
    },
    {
      category: "PROTECCIÓN ECONÓMICA Y CENSAL",
      test: "4. Rechaza expedición si faltan recursos o ciudadanos libres para formar la partida de exploradores",
      passed: !poorCheck.success && !noScoutCheck.success,
      details: `Pobre bloqueado: ${!poorCheck.success}; Sin explorador libre bloqueado: ${!noScoutCheck.success}`,
    },
    {
      category: "CONTROL DE CONCURRENCIA",
      test: "5. Respeta el límite autoritativo de 1 expedición de exploración activa por reino",
      passed: !busyCheck.success,
      details: `Segunda expedición simultánea bloqueada: ${!busyCheck.success}`,
    },
    {
      category: "PROGRESIÓN TEMPORAL",
      test: "6. Calcula el avance porcentual acotado entre 0 % y 100 % de forma determinista",
      passed: pStart === 0 && pMid === 50 && pDone === 100 && pPast === 100,
      details: `Inicio: ${pStart}%, Mitad: ${pMid}%, Fin: ${pDone}%, Posterior: ${pPast}%`,
    },
    {
      category: "REEMBOLSO DE CANCELACIÓN D-04/D-21",
      test: "7. Reembolsa exactamente el 50 % de oro y comida al cancelar una expedición en marcha",
      passed: refund.gold === 15 && refund.food === 20,
      details: `Oro reembolsado: ${refund.gold} (de 30), Alimentos reembolsados: ${refund.food} (de 40)`,
    },
    {
      category: "DESCUBRIMIENTOS TERRITORIALES",
      test: "8. Genera hallazgos deterministas con recompensas proporcionadas según el terreno explorado",
      passed: discovery.isFreeTerritory && discovery.resourceReward?.resource === "wood" && discovery.resourceReward.amount === 50,
      details: `Terreno: ${sampleCell.terrain}, Recompensa: ${discovery.resourceReward?.amount} de ${discovery.resourceReward?.resource}`,
    },
    {
      category: "INTEGRACIÓN TERRITORIAL P49",
      test: "9. Exige que un territorio libre esté explorado antes de poder ser reclamado mediante victoria aplastante",
      passed: !claimUnexplored.success && claimExplored.success,
      details: `Inexplorado bloqueado: ${!claimUnexplored.success}; Explorado admitido: ${claimExplored.success}`,
    },
    // =========================================================================
    // FILTRADO DE REINOS EN EL PARLAMENTO POR DESCUBRIMIENTO EN EL MAPA (BETA)
    // =========================================================================
    {
      category: "PARLAMENTO POR DESCUBRIMIENTO (CASO A)",
      test: "10. Caso A: Reino real no descubierto en el mapa -> NO aparece en el Parlamento",
      passed: (() => {
        const p1Sight = new Set(getInitialSightCellIds({ q: 0, r: 0 }));
        const p2Home = "5,5";
        const isP2Discovered = isKingdomDiscoveredOnMap("kingdom_2", p1Sight, [p2Home], p2Home);
        const candidates = [{ kingdomId: "kingdom_2", name: "Reino 2" }, { kingdomId: "kingdom_3", name: "Reino 3" }];
        const discoveredIds = new Set<string>();
        const filtered = filterDiscoveredKingdoms("kingdom_1", candidates, discoveredIds);
        return !isP2Discovered && filtered.length === 0;
      })(),
      details: "Reino 2 y Reino 3 bajo niebla de guerra: ninguno aparece en el Parlamento del Jugador 1.",
    },
    {
      category: "PARLAMENTO POR DESCUBRIMIENTO (CASO B)",
      test: "11. Caso B: Reino real descubierto en el mapa -> DEBE aparecer en el Parlamento",
      passed: (() => {
        const p1Known = new Set([...getInitialSightCellIds({ q: 0, r: 0 }), "5,5"]);
        const p2Home = "5,5";
        const isP2Discovered = isKingdomDiscoveredOnMap("kingdom_2", p1Known, [p2Home], p2Home);
        const isP3Discovered = isKingdomDiscoveredOnMap("kingdom_3", p1Known, ["-5,-5"], "-5,-5");
        const candidates = [{ kingdomId: "kingdom_2", name: "Reino 2" }, { kingdomId: "kingdom_3", name: "Reino 3" }];
        const discoveredIds = new Set<string>(["kingdom_2"]);
        const filtered = filterDiscoveredKingdoms("kingdom_1", candidates, discoveredIds);
        return isP2Discovered && !isP3Discovered && filtered.length === 1 && filtered[0].kingdomId === "kingdom_2";
      })(),
      details: "Celda 5,5 explorada: Reino 2 aparece como rival disponible; Reino 3 permanece inexplorado y oculto.",
    },
    {
      category: "PARLAMENTO POR DESCUBRIMIENTO (CASO C)",
      test: "12. Caso C: Exploración asimétrica: Jugador 1 descubre a Jugador 2, pero Jugador 2 NO a Jugador 1",
      passed: (() => {
        const p1Known = new Set([...getInitialSightCellIds({ q: 0, r: 0 }), "5,5"]);
        const p2Known = new Set(getInitialSightCellIds({ q: 5, r: 5 }));
        const p1DiscoversP2 = isKingdomDiscoveredOnMap("kingdom_2", p1Known, ["5,5"], "5,5");
        const p2DiscoversP1 = isKingdomDiscoveredOnMap("kingdom_1", p2Known, ["0,0"], "0,0");
        const p1Rivals = filterDiscoveredKingdoms("kingdom_1", [{ kingdomId: "kingdom_2" }], new Set(["kingdom_2"]));
        const p2Rivals = filterDiscoveredKingdoms("kingdom_2", [{ kingdomId: "kingdom_1" }], new Set<string>());
        return p1DiscoversP2 && !p2DiscoversP1 && p1Rivals.length === 1 && p2Rivals.length === 0;
      })(),
      details: "Jugador 1 ve a Jugador 2 en su Parlamento (1 rival); Jugador 2 no ve a Jugador 1 (0 rivales).",
    },
    {
      category: "PARLAMENTO POR DESCUBRIMIENTO (CASO D)",
      test: "13. Caso D: Persistencia tras recargas: el descubrimiento guardado en backend persiste entre sesiones",
      passed: (() => {
        // Simulación de reconstrucción de estado tras recarga a partir de exploredTerritories persistido
        const persistentExploredRecords = [{ kingdomId: "kingdom_1", cellId: "5,5", discoveredAt: 1700000000000 }];
        const sessionReloadedKnown = new Set([
          ...getInitialSightCellIds({ q: 0, r: 0 }),
          ...persistentExploredRecords.map((r) => r.cellId),
        ]);
        const reloadedDiscovered = isKingdomDiscoveredOnMap("kingdom_2", sessionReloadedKnown, ["5,5"], "5,5");
        const sessionRivals = filterDiscoveredKingdoms("kingdom_1", [{ kingdomId: "kingdom_2", name: "Reino 2" }], new Set(reloadedDiscovered ? ["kingdom_2"] : []));
        return reloadedDiscovered && sessionRivals.length === 1 && sessionRivals[0].kingdomId === "kingdom_2";
      })(),
      details: "Tras recargar sesión y leer exploredTerritories persistido, Reino 2 sigue disponible en el Parlamento.",
    },
    {
      category: "PARLAMENTO POR DESCUBRIMIENTO (EXCLUSIÓN PRUEBAS Y DEMO)",
      test: "14. Exclusión de reinos de prueba, verificación, demo Iberia y deduplicación",
      passed: (() => {
        const discovered = new Set(["k_iberia_demo", "k_verif", "k_pruebas", "k_real_1", "k_real_dup"]);
        const candidates = [
          { kingdomId: "k_iberia_demo", name: "Reino de Iberia", userId: "guest_g9ai8cz" },
          { kingdomId: "k_verif", name: "Reino de Verificación Remoto", monarchName: "Monarca" },
          { kingdomId: "k_pruebas", name: "Reino de Pruebas", monarchName: "GobernanteTestFundacion" },
          { kingdomId: "k_real_1", name: "Reino de Navarra", monarchName: "Sancho" },
          { kingdomId: "k_real_dup", name: "Reino de Navarra", monarchName: "Sancho II" },
        ];
        const filtered = filterDiscoveredKingdoms("my_kingdom", candidates, discovered);
        return (
          filtered.length === 1 &&
          filtered[0].kingdomId === "k_real_1" &&
          filtered[0].name === "Reino de Navarra"
        );
      })(),
      details: "Excluye demo Iberia, verificación y pruebas; deduplica Navarra. Solo 1 reino real legítimo visible.",
    },
  ];
}
