# Ampliación Integral del Árbol de Investigaciones — 56 Nuevas Tecnologías (135 → 191)

## 1. Resumen de la Ampliación

Se ha ampliado el catálogo tecnológico oficial de **La Conquista** (`convex/balanceConfig.ts`) en exactamente **56 investigaciones nuevas**, pasando de **135** a **191** tecnologías totales sin modificar ninguno de los 135 nodos previos (identificadores, costes, duraciones, requisitos, efectos ni comportamiento de `spy_2`), manteniendo el máximo de **3 ranuras de investigación simultáneas** (`RESEARCH.MAX_SLOTS = 3`) y el mapa de **7.651 hexágonos** (`MAP.RADIUS = 50`).

| Categoría | Anteriores | Nuevas | Total |
| --- | ---: | ---: | ---: |
| Universales (`economica`, `civil`, `militar`, `inteligencia`) | 87 | 20 (5 por rama) | 107 |
| Exclusivas de civilización (12 civilizaciones) | 48 (4/civ) | 36 (3/civ) | 84 (7/civ) |
| **TOTAL CATÁLOGO** | **135** | **56** | **191** |

- **Visibilidad por reino**: cada reino con civilización asignada accede exactamente a **114 investigaciones** (107 universales + 7 exclusivas de su civilización) y 0 de civilizaciones ajenas. Un reino sin civilización asignada accede únicamente a las **107 universales**.
- **Nuevos tramos de Universidad**:
  - **Nivel 6 · Avanzado**: duración base de `1.200 s` (universales y `_d`).
  - **Nivel 7 · Superior**: duración base de `1.500 s` (universales y `_e`).
  - **Nivel 8 · Maestría**: duración base de `1.800 s` (universales y `_f`).
  - En todos los nodos se cumple `castillo >= universidad` y dependencia tecnológica acíclica con `universidad(hija) >= universidad(requisito)`.

---

## 2. Nuevos Efectos y Topes en `convex/balanceConfig.ts` y `convex/technologyRules.ts`

Se añadieron tres nuevas claves de efecto (`TechnologyEffectKey`), todas conectadas a consumidores reales de servidor:

| Clave (`TechnologyEffectKey`) | Campo en `TechnologyModifiers` | Tope (`TECH_EFFECT_CAPS`) | Consumidores reales |
| --- | --- | --- | --- |
| `unitEfficiencySiege` | `unitEfficiencySiege` | `0.30` (`unitEfficiency`) | `battleRules.ts` (`strengths()` para unidades `!unit.isLivingTroop`), `army.ts` (`resolveMarch`), `parliament.ts` (`snapshotSide`), `botRules.ts` (`createBotBattleSide`) |
| `espionageCost` | `espionageCostReduction` | `0.40` | `technologyRules.ts` (`calculateEspionageCost`), `parliament.ts` (`requestEspionageReport`), `bots.ts` (`listBots`, `requestBotEspionage`) |
| `explorationCost` | `explorationCostReduction` | `0.35` | `explorationRules.ts` (`computeExplorationPlan`, `canStartExploration`), `territories.ts` (`getWorldMap`, `executeWorldMapCompactQuery`, `executeExplorationStart`) |

Además, `explorationSpeedBonus` quedó acotado explícitamente en `computeTechnologyModifiers` mediante `TECH_EFFECT_CAPS.explorationSpeed = 0.60`, preservando intactos todos los topes previos.

### Fórmulas exactas de los nuevos consumidores

- **Eficacia de maquinaria de asedio (`unitEfficiencySiege`)**:
  - `unitEfficiencyAll` sigue afectando exclusivamente a `infanteria`, `arqueria` y `caballeria`.
  - Cuando `!UNITS[type].isLivingTroop` (las 11 unidades de asedio), `strengths()` aplica `efficiency = side.unitEfficiencySiege ?? 0`, multiplicando ataque y defensa de unidad por `(1 + efficiency)`.
- **Descuento en informes de espionaje (`calculateEspionageCost`)**:
  - `baseCost = PARLIAMENT.ESPIONAGE.costByLevel[level]` (`100 / 250 / 500 / 1000`).
  - `cost = Math.max(1, Math.round(baseCost * (1 - clamp(espionageCostReduction, 0, 0.40))))`.
- **Descuento en expediciones de exploración (`explorationCostReduction`)**:
  - Tras aplicar la pasiva cultural (`applyCivilizationExploration`, p. ej. Navajos `−20 %`), se aplica el descuento tecnológico acumulado:
    - `gold = Math.max(1, Math.floor(civCosts.gold * (1 - explorationCostReduction) + 1e-9))`
    - `food = Math.max(1, Math.floor(civCosts.food * (1 - explorationCostReduction) + 1e-9))`
- **Capacidad residencial (`housingCapacity`)**:
  - Consumida en `buildings.ts`, `economy.ts` y `economyAdapter.ts` mediante `calculateResidentialCapacity(buildings, techModifiers.housingCapacityBonus)` y expuesta ahora a través de `housing_1..housing_4` (+24 % universal) y exclusivas de Griegos/Chinos/Aztecas (hasta el tope de +30 %).

---

## 3. Catálogo de las 20 Investigaciones Universales Nuevas (Niveles 6–8)

### Rama Económica (5)
1. `mining_10` (Univ 6, `1.200 s`): *Ruedas de desagüe y pozos profundos* — `miningProduction +0.08`. Req: `castillo: 8, universidad: 6, minaHierro: 6`, `[mining_8]`.
2. `mining_11` (Univ 7, `1.500 s`): *Bosques de ordenación y sierra doble* — `woodProduction +0.10`, `stoneProduction +0.10`. Req: `castillo: 9, universidad: 7, aserradero: 7, cantera: 7`, `[mining_10]`.
3. `mining_12` (Univ 8, `1.800 s`): *Forjas hidráulicas de martinete* — `ironProduction +0.10`, `goldProduction +0.06`. Req: `castillo: 10, universidad: 8, minaHierro: 8, herreria: 7`, `[mining_11, mining_9]`.
4. `storage_4` (Univ 6, `1.200 s`): *Depósitos reales y cilla metropolitana* — `storageCapacity +0.18`, `foodConsumption -0.03`. Req: `castillo: 8, universidad: 6, mercado: 6`, `[storage_3, agri_8]`.
5. `trade_5` (Univ 8, `1.800 s`): *Compañías mercantiles y letras reales* — `storageCapacity +0.15`, `mercenaryCost -0.08`. Req: `castillo: 10, universidad: 8, mercado: 8, taberna: 6`, `[trade_4, storage_4, merc_2]`.

### Rama Civil (5)
1. `housing_1` (Univ 6, `1.200 s`): *Ensanches de arrabal y parcelas urbanas* — `housingCapacity +0.06`. Req: `castillo: 8, universidad: 6, viviendas: 8`, `[construction_5]`.
2. `housing_2` (Univ 6, `1.200 s`): *Obras hidráulicas y alcantarillado urbano* — `housingCapacity +0.06`, `constructionDuration -0.03`. Req: `castillo: 8, universidad: 6, viviendas: 8`, `[housing_1, medicine_3]`.
3. `housing_3` (Univ 7, `1.500 s`): *Casas consistoriales y ordenanza urbana* — `housingCapacity +0.06`, `happinessBase +1`. Req: `castillo: 9, universidad: 7, viviendas: 9`, `[housing_2, happiness_6]`.
4. `construction_9` (Univ 7, `1.500 s`): *Arquitectura civil de bóvedas* — `constructionDuration -0.05`. Req: `castillo: 9, universidad: 7, cantera: 8`, `[construction_8, housing_2]`.
5. `housing_4` (Univ 8, `1.800 s`): *Planificación de grandes metrópolis* — `housingCapacity +0.06`, `happinessBase +1`. Req: `castillo: 10, universidad: 8, viviendas: 10`, `[housing_3, construction_9, happiness_7]`.

### Rama Militar (5)
1. `siege_1` (Univ 6, `1.200 s`): *Artillería de campaña y balística* — `unitEfficiencySiege +0.08`. Req: `castillo: 8, universidad: 6, cuartel: 6, herreria: 6`, `[tactics_all, advanced_steel]`.
2. `siege_2` (Univ 7, `1.500 s`): *Maestros ingenieros de sitio* — `unitEfficiencySiege +0.10`. Req: `castillo: 9, universidad: 7, cuartel: 7, herreria: 7`, `[siege_1]`.
3. `training_6` (Univ 6, `1.200 s`): *Escuelas de suboficiales y reclutamiento* — `trainingDuration -0.06`. Req: `castillo: 8, universidad: 6, cuartel: 7`, `[training_5]`.
4. `medical_6` (Univ 7, `1.500 s`): *Cuerpo sanitario de retaguardia* — `woundedRate +0.05`, `woundedRecovery +0.05`. Req: `castillo: 9, universidad: 7, hospitalMilitar: 6`, `[medical_5]`.
5. `logistics_7` (Univ 8, `1.800 s`): *Cuerpo de bagajes y campaña profunda* — `fatigueAccrual -0.08`, `marchFatigue -0.05`, `trainingDuration -0.05`. Req: `castillo: 10, universidad: 8, cuartel: 8`, `[logistics_6, training_6]`.

### Rama Inteligencia (5)
1. `spy_5` (Univ 6, `1.200 s`): *Cancillería cifrada y red de informadores* — `espionageCost -0.10`, `counterEspionage +0.06`. Req: `castillo: 8, universidad: 6, parlamento: 4`, `[spy_4, espionage_4]`.
2. `spy_6` (Univ 6, `1.200 s`): *Cartografía astronómica y portulanos* — `explorationSpeed +0.12`, `explorationCost -0.08`. Req: `castillo: 8, universidad: 6`, `[spy_2, espionage_3]`.
3. `spy_7` (Univ 7, `1.500 s`): *Correos encubiertos y enlaces clandestinos* — `espionageCost -0.12`, `explorationCost -0.10`. Req: `castillo: 9, universidad: 7, parlamento: 5`, `[spy_5, spy_6]`.
4. `spy_8` (Univ 7, `1.500 s`): *Vanguardia de descubierta y agrimensores* — `explorationSpeed +0.13`, `marchSpeed +0.05`. Req: `castillo: 9, universidad: 7`, `[spy_6]`.
5. `spy_9` (Univ 8, `1.800 s`): *Consejo supremo de inteligencia* — `counterEspionage +0.10`, `espionageCost -0.08`, `explorationSpeed +0.10`. Req: `castillo: 10, universidad: 8, parlamento: 6`, `[spy_7, spy_8]`.

---

## 4. Catálogo de las 36 Investigaciones Exclusivas Nuevas (3 × 12 Civilizaciones)

Cada civilización extiende su cadena `base → _a, _b → _c` con tres nodos consecutivos:
- `_d` (Univ 6, `1.200 s`, `castillo: 6, universidad: 6`, req `[_c]`, coste `2.400/850/800/450/0`).
- `_e` (Univ 7, `1.500 s`, `castillo: 7, universidad: 7`, req `[_d]`, coste `3.200/1.100/1.050/600/0`).
- `_f` (Univ 8, `1.800 s`, `castillo: 8, universidad: 8`, req `[_e]`, coste `4.200/1.400/1.350/800/0`).

| Civilización | `_d` (Univ 6) | `_e` (Univ 7) | `_f` (Univ 8) |
| --- | --- | --- | --- |
| **Ingleses** | `woodProduction +0.10` | `unitEfficiencyArc +0.08` | `unitEfficiencySiege +0.10`, `combatDefense +0.05` |
| **Romanos** | `stoneProduction +0.10` | `unitEfficiencySiege +0.12` | `combatDefense +0.08`, `marchFatigue -0.08` |
| **Griegos** | `goldProduction +0.10` | `happinessBase +4`, `housingCapacity +0.05` | `combatDefense +0.08`, `unitEfficiencyInf +0.06` |
| **Vikingos** | `explorationSpeed +0.15`, `explorationCost -0.10` | `unitEfficiencyInf +0.08` | `storageCapacity +0.12`, `goldProduction +0.08` |
| **Bizantinos** | `espionageCost -0.10`, `counterEspionage +0.07` | `unitEfficiencySiege +0.10` | `unitEfficiencyCav +0.05`, `combatDefense +0.04` |
| **Árabes** | `agricultureProduction +0.12` | `unitEfficiencyCav +0.07`, `marchSpeed +0.10` | `unitEfficiencySiege +0.10`, `combatAttack +0.06` |
| **Mongoles** | `marchFatigue -0.15`, `marchSpeed +0.05` | `unitEfficiencySiege +0.12` | `combatAttack +0.12` |
| **Chinos** | `agricultureProduction +0.12`, `housingCapacity +0.06` | `unitEfficiencyArc +0.08`, `unitEfficiencySiege +0.10` | `combatDefense +0.10` |
| **Japoneses** | `ironProduction +0.10`, `miningProduction +0.08` | `espionageCost -0.10`, `counterEspionage +0.07` | `unitEfficiencyInf +0.09`, `combatDefense +0.08` |
| **Navajos** | `explorationCost -0.15`, `explorationSpeed +0.12` | `unitEfficiencyArc +0.12`, `woodProduction +0.10` | `marchSpeed +0.10`, `combatAttack +0.08` |
| **Aztecas** | `agricultureProduction +0.08`, `housingCapacity +0.06` | `unitEfficiencyInf +0.07`, `unitEfficiencyCav +0.10` | `combatAttack +0.10`, `fatigueAccrual -0.08` |
| **Masáis** | `foodConsumption -0.02`, `fatigueAccrual -0.10` | `unitEfficiencyInf +0.07`, `combatDefense +0.08` | `marchSpeed +0.12`, `combatAttack +0.10` |

---

## 5. Verificación de Ausencia de Desbordamiento de Topes (12/12 Civilizaciones)

Con las **107 investigaciones universales** más las **7 exclusivas propias**, la suma acumulada de todos los modificadores permanece `<= cap` en las 12 civilizaciones (verificado automáticamente en el test 27 de `convex/technologyPureTests.ts`):

- **Máximos universales base (sin exclusivas)**: `agricultureProduction 0.49/0.65`, `miningProduction 0.34/0.50`, `wood/stone/ironProduction 0.20/0.30`, `goldProduction 0.42/0.60`, `storageCapacity 0.88/1.00`, `foodConsumption 0.07/0.15`, `housingCapacity 0.24/0.30`, `constructionDuration -0.32/-0.40`, `researchDuration -0.34/-0.40`, `happinessBase 24/30`, `mercenaryCost 0.26/0.30`, `trainingDuration -0.40/-0.40`, `woundedRate 0.20/0.20`, `woundedRecovery 0.20/0.60`, `fatigueAccrual 0.19/0.30`, `marchFatigue 0.25/0.50`, `marchSpeed 0.25/0.55`, `combatAttack 0.06/0.25`, `combatDefense 0.07/0.25`, `moraleBase 9/15`, `unitEfficiencyInf/Arc/Cav 0.13/0.30`, `unitEfficiencySiege 0.18/0.30`, `counterEspionage 0.53/0.60`, `explorationSpeed 0.45/0.60`, `explorationCost 0.18/0.35`, `espionageCost 0.30/0.40`.
- **Picos por civilización (todos `<= cap`)**:
  - **Ingleses**: `combatAttack 0.23/0.25`, `unitEfficiencyArc 0.29/0.30`, `woodProduction 0.30/0.30`, `unitEfficiencySiege 0.28/0.30`.
  - **Romanos**: `unitEfficiencyInf 0.30/0.30`, `unitEfficiencySiege 0.30/0.30`, `stoneProduction 0.30/0.30`, `combatDefense 0.20/0.25`.
  - **Griegos**: `unitEfficiencyArc 0.28/0.30`, `unitEfficiencyInf 0.27/0.30`, `happinessBase 28/30`, `housingCapacity 0.29/0.30`, `goldProduction 0.52/0.60`.
  - **Vikingos**: `explorationSpeed 0.60/0.60`, `storageCapacity 1.00/1.00`, `unitEfficiencyInf 0.29/0.30`, `goldProduction 0.58/0.60`.
  - **Bizantinos**: `combatDefense 0.25/0.25`, `unitEfficiencyCav 0.30/0.30`, `espionageCost 0.40/0.40`, `counterEspionage 0.60/0.60`.
  - **Árabes**: `researchDuration -0.40/-0.40`, `unitEfficiencyCav 0.30/0.30`, `agricultureProduction 0.61/0.65`, `marchSpeed 0.35/0.55`.
  - **Mongoles**: `marchSpeed 0.55/0.55`, `unitEfficiencyCav 0.28/0.30`, `unitEfficiencySiege 0.30/0.30`, `marchFatigue 0.40/0.50`.
  - **Chinos**: `happinessBase 30/30`, `housingCapacity 0.30/0.30`, `unitEfficiencyArc 0.29/0.30`, `combatDefense 0.23/0.25`.
  - **Japoneses**: `ironProduction 0.30/0.30`, `unitEfficiencyInf 0.30/0.30`, `espionageCost 0.40/0.40`, `counterEspionage 0.60/0.60`.
  - **Navajos**: `woodProduction 0.30/0.30`, `explorationCost 0.33/0.35`, `explorationSpeed 0.57/0.60`, `marchSpeed 0.47/0.55`.
  - **Aztecas**: `agricultureProduction 0.65/0.65`, `housingCapacity 0.30/0.30`, `unitEfficiencyInf 0.30/0.30`, `unitEfficiencyCav 0.23/0.30`.
  - **Masáis**: `marchFatigue 0.50/0.50`, `moraleBase 15/15`, `foodConsumption 0.15/0.15`, `unitEfficiencyInf 0.30/0.30`, `fatigueAccrual 0.29/0.30`.

---

## 6. Interfaz (`src/components/UniversityPanel.tsx`)

- Se amplió `TechnologiesState` para incluir `unitEfficiencySiege`, `explorationSpeedBonus`, `explorationCostReduction`, `espionageCostReduction` y `secondaryEffects`.
- Se añadieron pestañas de filtro por rama (`Todas`, `Económica`, `Civil`, `Militar`, `Inteligencia`, `Civilización`) y filtros de estado/rango (`Todo el árbol`, `Disponibles / en curso`, `Investigadas`, `Niveles 6–8 (Avanzado–Maestría)`).
- Cada tarjeta ordena por nivel de Universidad y muestra la etiqueta de tier correspondiente, incluyendo `Nivel 6 · Avanzado`, `Nivel 7 · Superior` y `Nivel 8 · Maestría`, sin añadir imágenes ni identificadores gráficos nuevos.
