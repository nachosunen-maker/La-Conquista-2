# CÁLCULOS MATEMÁTICOS — LA CONQUISTA (COMPLETO Y AUDITADO)
Fecha: 2026-10-28

Este documento recopila las fórmulas matemáticas, constantes numéricas y parámetros de balance del proyecto La Conquista, extraídos directamente del código fuente (`convex/`) y validados mediante la batería de 200 pruebas automatizadas.

---

## 1. TIEMPO Y ESCALA TEMPORAL
- **Equivalencia temporal**: 1 día real (86.400 segundos = 86.400.000 ms) equivale a 1 año de juego (365 días de juego).
- **Constantes (`convex/balanceConfig.ts`)**:
  - `TIME.SECONDS_PER_GAME_YEAR = 86_400`
  - `TIME.MS_PER_GAME_YEAR = 86_400_000`
  - `TIME.HOURS_PER_DAY = 24`
- **Conversión de tiempo en juego**:
  - Años de juego: `anios = duracionSegundos / 86.400`
  - Días de juego: `dias = duracionSegundos * (365 / 86.400)`
- **Archivo**: `convex/balanceConfig.ts` (`TIME`).
- **Prueba**: `convex/foundationPureTests.ts` (escala temporal y sincronización de ticks).

---

## 2. ECONOMÍA Y PRODUCCIÓN
- **Población inicial oficial**: 2.000 habitantes (`INITIAL_KINGDOM_CONFIG.population = 2_000`).
- **Producción diaria por trabajador asignado (`PRODUCTION_PER_WORKER_PER_DAY`)**:
  - Alimento (agricultura): 2,0 / trabajador · día
  - Madera: 1,0 / trabajador · día
  - Piedra: 0,75 / trabajador · día
  - Hierro: 0,40 / trabajador · día
  - Oro: 0,20 / trabajador · día
- **Regla fundamental de trabajo**: Sin trabajadores asignados la producción es exactamente 0 (`convex/economyCalculations.ts`).
- **Consumo de alimentos (`FOOD`)**:
  - Civiles: 1,0 ración / habitante · día (`FOOD.RATION_PER_CITIZEN_PER_DAY = 1.0`).
  - Soldados regulares: 1,05 raciones / soldado · día (`FOOD.SOLDIER_RATION_MULTIPLIER = 1.05`).
  - Maquinaria de asedio: 0 raciones / máquina · día (`UNITS.asedio.foodConsumption = 0`).
  - Mercenarios: 1,0 ración / mercenario · día + coste en oro según tipo (`MERCENARIES.BASE_GOLD_MAINTENANCE_PER_DAY`).
- **Almacenamiento (`STORAGE`)**:
  - Capacidad base: 10.000 unidades por recurso (`STORAGE.BASE_CAPACITY = 10_000`).
  - Incremento por nivel de Mercado: +2.000 unidades (`STORAGE.CAPACITY_PER_MARKET_LEVEL = 2_000`).
  - Techo: `Capacidad = 10.000 + 2.000 * nivelMercado`. Las reservas previas que superen el tope no se destruyen, pero el excedente producido en el intervalo se pierde.
- **Políticas de descanso (`REST_POLICIES`)**:
  - Normal: factor 1,00, felicidad neutral.
  - Intensiva: factor 1,15 (+15 % producción), −3 felicidad/día, +5 fatiga/día.
  - Relajada: factor 0,90 (−10 % producción), +2 felicidad/día, −5 fatiga/día.
- **Archivos**: `convex/balanceConfig.ts`, `convex/economyCalculations.ts`, `convex/economyExtended.ts`.
- **Pruebas**: `convex/economyPureTests.ts`, `convex/economyRound2PureTests.ts`.

---

## 3. PROFESIONES Y TRABAJADORES MÉDICOS
- **Capacidades máximas de asignación por nivel de edificio (`PROFESSION_BUILDING_CAPACITY`)**:
  - Hospital militar (medicina): 50 trabajadores / nivel.
  - Iglesia (religión): 30 trabajadores / nivel.
  - Circo (espectáculo): 40 trabajadores / nivel.
  - Panadería (panadería): 30 trabajadores / nivel.
  - Construcción: sin edificio específico (capacidad ilimitada, asignación directa).
- **Efectos de profesiones (`PROFESSION_EFFECTS`)**:
  - **Medicina** (`hospitalMilitar`):
    - Escala: 10 trabajadores por paso (`workersPerStep = 10`).
    - Bonificación: +0,01 (+1 pp) a la tasa de recuperación de heridos por cada 10 trabajadores.
    - Tope máximo: +0,10 (+10 pp) de bonificación médica (`maxBonus = 0.10`).
  - **Religión** (`iglesia`): +1 felicidad / 20 trabajadores (tope +3).
  - **Espectáculo** (`circo`): +1 felicidad / 20 trabajadores (tope +3).
  - **Panadería** (`panaderia`): −5 % consumo de comida / 20 trabajadores (tope −15 %).
  - **Construcción**: −1 % duración de construcción / 10 trabajadores (tope −20 %).
- **Archivos**: `convex/balanceConfig.ts`, `convex/economyCalculations.ts`.
- **Prueba**: `convex/economyRound2PureTests.ts` (Test: *Profesiones M-07: medicina +1 pp/10...*).

---

## 4. CONSTRUCCIÓN DE EDIFICIOS
- **Coste por nivel $n$**:
  $$\text{Coste}(n) = \text{round}\left(\text{CosteBase} \times 1.15^{n-1}\right)$$
- **Duración de construcción por nivel $n$**:
  $$\text{Duración}(n) = \left\lceil \text{DuraciónBaseMs} \times 1.01^{n-1} \times M_{\text{civ}} \times M_{\text{prof}} \right\rceil$$
  - Romanos: $M_{\text{civ}} = 0.90$ (−10 % duración).
  - Profesión constructores: hasta −20 % de duración adicional.
- **Vivienda / Capacidad residencial (`calculateResidentialCapacity`)**:
  - Casas: 100 habitantes / nivel.
  - Castillo: 50 habitantes / nivel.
  - Choza: 20 habitantes / nivel.
- **Archivos**: `convex/buildingRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/constructionPureTests.ts`.

---

## 5. INVESTIGACIÓN Y TECNOLOGÍAS
- **Duración base**: 86.400 segundos reales (1 año de juego).
- **Modificador griego**: 77.760 segundos (−10 % duración).
- **Costes**: Definidos por tecnología en `TECHNOLOGY_DEFINITIONS` (`convex/balanceConfig.ts`).
- **Efectos acumulativos**: Multiplicadores sumados a producción, capacidad hospitalaria, felicidad o poder militar.
- **Archivos**: `convex/technologyRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/technologyPureTests.ts`.

---

## 6. MAPA, DESPLAZAMIENTO Y FATIGA MILITAR
- **Mapa axial hexagonal (`MAP`)**:
  - Radio del mapa: 10 hexágonos (`MAP.RADIUS = 10`), 331 celdas totales (`generateWorldCells`).
  - Semilla fija reproducible: `MAP.WORLD_SEED = 20261017`.
  - Terrenos: llanura (30 %), bosque (25 %), colina (20 %), montaña (15 %), río (10 %), costa en borde.
- **Desplazamiento y duración de marcha militar (`calculateArmyMarchPlan`)**:
  $$T_{\text{marcha}} = \text{clamp}\left(T_{\text{min}},\, T_{\text{max}},\, \left\lceil \frac{T_{\text{base}} \times d \times M_{\text{terreno}} \times M_{\text{unidad}}}{\max(0.1, M_{\text{civ\_vel}})} \right\rceil \right)$$
  - $T_{\text{base}} = 1.800\text{ s}$ por hexágono (`MAP.MARCH_SECONDS_PER_HEX = 1800`).
  - $d$: distancia hexagonal (`hexDistance(from, to)`).
  - $M_{\text{terreno}}$: promedio de las celdas atravesadas (`pathTerrainMultiplier`, R-14).
  - $M_{\text{unidad}}$: velocidad de la unidad más lenta del ejército (`armyMarchMultiplier`):
    - Infantería: 1,0
    - Arquería: 1,0
    - Caballería: 1,2
    - Asedio: 1,5
  - $M_{\text{civ\_vel}}$: Mongoles = 1,15 (+15 % velocidad); neutral = 1,0.
  - Límites de salvaguarda: $T_{\text{min}} = 900\text{ s}$ (15 min reales), $T_{\text{max}} = 43.200\text{ s}$ (12 h reales).
  - Ventana de preparación pre-batalla:
    $$\text{Ventana} = \max(900\text{ s},\, \min(3.600\text{ s},\, \text{round}(0.20 \times T_{\text{marcha}})))$$
- **Fatiga de marcha y recuperación (`marchFatigue`, `recoverFatigue`)**:
  - Acumulación por marcha:
    $$F_{\text{devengada}} = \left\lceil 2 \times d \times M_{\text{terreno}} \times M_{\text{civ\_fatiga}} \right\rceil$$
    (Masáis: $M_{\text{civ\_fatiga}} = 0.75$ [−25 % acumulación]).
  - Límite: $F \in [0, 100]$.
  - Multiplicadores de poder de combate por fatiga (`FATIGUE_TABLE`):
    - 0–10: 1,00
    - 11–25: 0,97
    - 26–40: 0,92
    - 41–60: 0,85
    - 61–75: 0,75
    - 76–90: 0,60
    - 91–100: 0,45
  - Recuperación en descanso:
    $$F_{\text{nuevo}} = \max(0,\, F_{\text{actual}} - 10 \times \text{días\_reales}) \quad (\text{solo con ración } \ge \text{normal})$$
- **Archivos**: `convex/territoryRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/territoryPureTests.ts` (Test: *Marcha P41: 1.800 s por hexágono...* y Test: *Fatiga P32: +2 por hexágono...*).

---

## 7. MOTOR DE COMBATE
- **Fórmula de Potencia de Bando (`computeSideFactors`)**:
  $$P_{\text{bando}} = N^{0.85} \times E^{0.60} \times W^{0.45} \times A^{0.30} \times \text{Form}^{0.30} \times M^{0.15} \times \text{Alim}^{0.15} \times \text{Fat}^{0.15} \times \text{Contr} \times \text{Estrat} \times M_{\text{civ}} \times \text{Murallas}$$
  - Exponentes (`COMBAT.EXPONENTS`):
    - Tropas ($N$): 0,85
    - Entrenamiento ($E$): 0,60
    - Armas ($W$): 0,45
    - Armadura ($A$): 0,30
    - Formación ($\text{Form}$): 0,30
    - Moral ($M$): 0,15 (conversión: $0,50 + \frac{\text{Moral}}{200}$, rango 0,50–1,00)
    - Alimentos ($\text{Alim}$): 0,15 (rango 0,80–1,05)
    - Fatiga ($\text{Fat}$): 0,15 (rango 0,45–1,00 según `FATIGUE_TABLE`)
  - Murallas: $+5\%$ defensa por nivel hasta $+50\%$ máximo (`WALLS_DEFENSE_PER_LEVEL = 0.05`, `WALLS_DEFENSE_MAX = 0.50`). Asedio rinde $\times 1,8$ contra murallas y $\times 1,0$ a campo abierto.
  - Contramedidas de unidades: Caballería $\to$ Arqueros $\to$ Infantería $\to$ Caballería ($+25\%$ efectividad, `FORMATION_COUNTER_BONUS = 0.25`).
  - Estrategias (ofensiva, defensiva, flanqueo, guerrilla): modificador 0,80–1,25 (`STRATEGY_MATRIX`).
  - Formaciones tácticas: ciclo ofensiva $\to$ flanqueo $\to$ defensiva $\to$ ofensiva ($\times 1,12$ efectividad), equilibrada neutral ($\times 1,00$).
- **Resolución de Bajas (Modelo Lanchester Acotado, `applyLanchesterRound`)**:
  $$\text{Daño} = 0.40 \times \left(\frac{P_{\text{atacante}}}{P_{\text{defensor}}}\right)^{0.50} \times N_{\text{atacante}}$$
  - Bajas máximas por ronda: 40 % de los efectivos vivos (`MAX_CASUALTIES_RATIO_PER_ROUND = 0.40`).
  - Máximo 3 rondas (`COMBAT.ROUNDS = 3`).
  - Retirada forzosa: pérdidas en ronda $\ge 70\%$ (`RETREAT_LOSS_RATIO = 0.70`) o moral $< 20$ (`RETREAT_MORALE_BELOW = 20`).
- **Contabilidad Cerrada de Bajas, Muertos y Heridos**:
  $$\text{Efectivos}_{\text{iniciales}} = \text{Supervivientes} + \text{Bajas}_{\text{totales}}$$
  $$\text{Heridos} = \text{round}(\text{Bajas} \times 0.65) \quad (\text{P44, } \text{COMBAT.WOUNDED\_RATIO} = 0.65)$$
  $$\text{Muertos} = \text{Bajas} - \text{Heridos}$$
  Sin creación ni pérdida de efectivos por redondeo.
- **Desgaste de Equipamiento (`calculateEquipmentWear`)**:
  $$\text{Desgaste}(\%) = \text{lossRatio} \times 100\% \quad (0 \text{ a } 100\%)$$
- **Archivos**: `convex/battleRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/battlePureTests.ts` (B-01, B-02, murallas, moral, Lanchester y contabilidad cerrada).

---

## 8. RESULTADOS, HONOR, GLORIA Y EMPATE
- **Condición de Empate**: Si tras 3 rondas ningún bando se retira y $|\text{bajas}_{\text{atk}} - \text{bajas}_{\text{def}}| \le 0.05$ (o fuerzas iguales), se declara empate.
  - Ganador: `null`.
  - Recompensa: $+5$ honor a cada bando, $0$ gloria, $0$ territorio.
- **Condición de Victoria Aplastante (`crushingVictory`)**: Bajas del perdedor $\ge 75\%$ (`CRUSHING_VICTORY_LOSS_RATIO = 0.75`) o retirada forzosa.
  - Recompensa: $+50$ honor, $+30$ gloria, $+1$ derecho de reclamación territorial libre cercana (distancia $\le 2$).
- **Tabla de Recompensas de Batalla (`BATTLE_REWARDS`)**:
  - Victoria aplastante: $+50$ honor, $+30$ gloria.
  - Victoria decisiva ($\ge 50\%$ bajas rival): $+30$ honor, $+18$ gloria.
  - Victoria estándar ($\ge 25\%$ bajas rival): $+20$ honor, $+10$ gloria.
  - Victoria ajustada ($< 25\%$ bajas rival): $+12$ honor, $+6$ gloria.
  - Empate: $+5$ honor, $0$ gloria.
  - Derrota: $0$ honor, $-5$ gloria (gloria nunca inferior a 0).
- **Mecanismo Anti-Exploit de Escalado por Tamaño (`BATTLE_REWARDS.SIZE_SCALING`)**:
  $$S_{\text{escala}} = \text{clamp}(0.10,\, 1.50,\, \sqrt{N_{\text{def}}/N_{\text{atk}}}) \times \begin{cases} \frac{\min(N_{\text{atk}}, N_{\text{def}})}{10} & \text{si } < 10 \\ 1.0 & \text{en otro caso} \end{cases}$$
  Impide farmear honor/gloria con duelos artificiales de 1 soldado contra 1 soldado o contra ejércitos diminutos.
- **Decaimiento pasivo de Gloria**: −1 punto por día real (`GLORY_DECAY_PER_DAY = 1`).
- **Bonificación de Moral por Gloria**: $+1$ moral por cada 10 puntos de gloria acumulada, hasta $+10$ máximo.
- **Archivos**: `convex/battleRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/battlePureTests.ts` (Test 1 empate, Test 2 victoria élite, Test 3 aplastante).

---

## 9. GESTIÓN HOSPITALARIA Y RECUPERACIÓN DE HERIDOS
- **Capacidad hospitalaria (`HOSPITAL.CAPACITY_PER_LEVEL`)**:
  $$\text{Capacidad} = \text{nivelHospital} \times 100\text{ camas}$$
- **Tasa anual de recuperación según nivel (`HOSPITAL_RECOVERY_PER_YEAR`)**:
  - Nivel 1: 15 % anual
  - Nivel 2: 22 % anual
  - Nivel 3: 30 % anual
  - Nivel 4: 40 % anual
  - Nivel 5+: 50 % anual
- **Bonificaciones sumadas a la tasa anual**:
  - Tecnologías médicas: $+\text{bonus}$
  - Trabajadores médicos: $+0,01$ por cada 10 médicos (tope $+0,10$)
  - Pasiva árabe: $+0,08$ (+8 pp)
  - **Tope acumulado absoluto**: 60 % anual (`HOSPITAL_RECOVERY_CAP = 0.60`).
- **Heridos en exceso / Triaje en campaña (`HOSPITAL.FIELD_RECOVERY_RATE`)**:
  - Los heridos dentro de la capacidad de camas se recuperan a la tasa del hospital.
  - Los heridos que superan la capacidad (exceso) reciben triaje de campaña a tasa reducida del 5 % anual (`FIELD_RECOVERY_RATE = 0.05`).
  - Tasa efectiva ponderada:
    $$\text{Tasa}_{\text{efectiva}} = \frac{\text{Heridos}_{\text{hosp}} \times \text{Tasa}_{\text{base}} + \text{Heridos}_{\text{exceso}} \times 0.05}{\text{Heridos}_{\text{totales}}}$$
- **Archivos**: `convex/battleRules.ts` (`calculateHospitalRecovery`, `woundedRecoveryRatio`), `convex/balanceConfig.ts`.
- **Prueba**: `convex/battlePureTests.ts` (Test 8: *recuperación hospitalaria P45 con tope 60 % y desgaste de equipamiento*).

---

## 10. SINGULARIDADES Y DEBILIDADES DE LAS 12 CIVILIZACIONES
1. **Romanos**: −10 % duración de construcción (`constructionDurationMultiplier = 0.90`).
2. **Griegos**: −10 % duración de investigación (`researchDurationMultiplier = 0.90`), +5 felicidad base.
3. **Egipcios**: +10 % producción de oro (`production.gold = 0.10`).
4. **Vikingos**: −15 % duración de expediciones (`explorationDurationMultiplier = 0.85`).
5. **Japoneses**: +5 % ataque militar (`combatAttackMultiplier = 1.05`).
6. **Mongoles**: +15 % velocidad de marcha (`marchSpeedMultiplier = 1.15`). Debilidad: −5 % defensa (`combatDefenseMultiplier = 0.95`).
7. **Árabes**: +8 pp recuperación de heridos (`woundedRecoveryBonus = 0.08`).
8. **Ingleses**: +10 % producción de madera (`production.wood = 0.10`). Debilidad: +15 % coste de oro en caballería (`cavalryGoldCostMultiplier = 1.15`).
9. **Francos**: +10 % producción de hierro (`production.iron = 0.10`).
10. **Chinos**: +10 % producción de piedra (`production.stone = 0.10`).
11. **Masáis**: −25 % acumulación de fatiga de marcha (`fatigueAccrualMultiplier = 0.75`). Debilidad: −5 % fuerza defensiva (`combatDefenseMultiplier = 0.95`).
12. **Navajos (Indios Americanos)**: −20 % costes en expediciones (`explorationCostMultiplier = 0.80`), +8 % producción de madera. Debilidad: +10 % duración de instrucción de asedio (`trainingDurationByUnit.asedio = 1.10`).
- **Archivos**: `convex/balanceConfig.ts`, `convex/civilizationRules.ts`, `convex/armyRules.ts`, `convex/battleRules.ts`.
- **Prueba**: `convex/civilizationPureTests.ts` (Pruebas 1 a 13 superadas).

---

## 11. SISTEMA DE MISIONES Y RECOMPENSAS
- **Catálogo de 44 misiones (`convex/balanceConfig.ts`, `MISSIONS`)**:
  - 4 etapas secuenciales (castillo, cuartel, universidad, herrería, tropas, población).
  - 6 misiones diarias (rotación de 3 por día determinista según fecha UTC).
  - 16 misiones secretas (incluyendo 1 por civilización y metas de felicidad/tesoro).
- **Bonificaciones temporales**: Acumulativas por multiplicación de factores vigentes, ignorando caducadas.
- **Archivos**: `convex/missionRules.ts`, `convex/balanceConfig.ts`.
- **Prueba**: `convex/missionPureTests.ts` (Pruebas 1 a 6 superadas).

---

## 12. ESTATUS FINAL DE AUDITORÍA
- **Total de pruebas automatizadas**: 200/200 superadas (100 % de éxito, 0 fallos).
- **TypeScript (`tsc --noEmit && tsc --noEmit -p convex`)**: 0 errores.
- **Compilación de la aplicación (`compile_applet`)**: Correcta y verificada.
- **Escala temporal**: 1 día real = 1 año de juego en todos los cálculos y módulos.
- **Protección de producción**: Reino de demostración Iberia inalterado, sin despliegues remotos ni modificaciones destructivas.
