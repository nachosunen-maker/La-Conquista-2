# Ampliación Integral del Árbol de Investigaciones — Documentación Económica y Validación Técnica (56 Nuevas Tecnologías)

## 1. Alcance y Arquitectura Económica Real del Motor Tecnológico

La ampliación del catálogo oficial (`convex/balanceConfig.ts`, `TECHNOLOGIES`) incorpora exactamente **56 investigaciones nuevas** sobre las **135 originales**, alcanzando un total inmutable de **191 tecnologías** (20 universales nuevas + 36 exclusivas de civilización en los niveles de Universidad **6, 7 y 8**).

### 1.1. Mecanismo real de costes y duraciones en el código

Tras auditar directamente `convex/balanceConfig.ts`, `convex/technologyRules.ts` y `convex/technologies.ts`, queda acreditado que:

- **Costes estáticos literales (sin fórmula generadora en tiempo de ejecución):** Las 56 investigaciones nuevas (igual que las 135 previas) definen su propiedad `costs: { gold, wood, stone, iron, food }` mediante **valores enteros estáticos** directamente en `TECHNOLOGIES` (`convex/balanceConfig.ts`, líneas 1144–1230). La función `createResearchPlan()` (`convex/technologyRules.ts`, líneas 390–403) valida y descuenta `technology.costs[resource]` tal cual, sin aplicar multiplicadores dinámicos ni descuentos por tecnología/edificio al coste de investigar.
- **Reembolso por cancelación (`calculateResearchCancellationRefund`, `convex/technologyRules.ts`, líneas 427–443):**
  ```ts
  refund[resource] = Math.floor(entry.costs[resource] * RESEARCH.CANCEL_REFUND_RATIO); // RESEARCH.CANCEL_REFUND_RATIO = 0.5
  ```
- **Duración de investigación (`computeResearchDuration`, `convex/technologyRules.ts`, líneas 62–78):**
  ```ts
  // base = Math.round(duracionNominal * RESEARCH_TIME_SCALE)   // RESEARCH_TIME_SCALE = 1.0
  // techMul = Math.max(1 - TECH_EFFECT_CAPS.researchDuration, 1 + sumResearchDuration) // mínimo 0.60
  // civMul  = civPassive.researchDurationMultiplier // 0.90 en Árabes; 1.00 en el resto
  combinedMultiplier = Math.round(techMul * civMul * 1e9) / 1e9;
  rawSeconds = Math.round(base * combinedMultiplier * 1e9) / 1e9;
  durationSeconds = Math.max(1, Math.ceil(rawSeconds));
  durationMs = durationSeconds * 1000;
  ```
- **Ranuras de investigación (`researchSlots`, `convex/technologyRules.ts`, líneas 53–59):** Los niveles 6, 7 y 8 de Universidad conservan el máximo global `RESEARCH.MAX_SLOTS = 3` (sin 4.ª ranura).
- **Topes y consumidores reales de las nuevas claves de efecto (`computeTechnologyModifiers`):**
  - `unitEfficiencySiege` (tope `TECH_EFFECT_CAPS.unitEfficiency = 0.30`): aplicado en `battleRules.ts` (`strengths()`) únicamente a unidades con `!unit.isLivingTroop`, propagado en `army.ts`, `parliament.ts` y `botRules.ts`.
  - `espionageCost` -> `espionageCostReduction` (tope `TECH_EFFECT_CAPS.espionageCost = 0.40`): aplicado en `calculateEspionageCost(level, reduction)` (`Math.max(1, Math.round(baseCost * (1 - clamp(reduction, 0, 0.40))))` sobre `PARLIAMENT.ESPIONAGE.costByLevel = {1: 100, 2: 250, 3: 500, 4: 1000}`), consumido por `parliament.ts` (`requestEspionageReport`) y `bots.ts` (`listBots`, `requestBotEspionage`).
  - `explorationCost` -> `explorationCostReduction` (tope `TECH_EFFECT_CAPS.explorationCost = 0.35`): aplicado tras la pasiva cultural en `explorationRules.ts` (`Math.max(1, Math.floor(civCosts[res] * (1 - reduction) + 1e-9))`), consumido por `territories.ts` (`getWorldMap`, `executeWorldMapCompactQuery`, `executeExplorationStart`).
  - `explorationSpeed` -> `explorationSpeedBonus` (tope `TECH_EFFECT_CAPS.explorationSpeed = 0.60`): aplicado en `calculateExplorationDurationMs` (`Math.max(MIN_EXPLORATION_DURATION_MS, Math.ceil(baseMs / (1 + explorationSpeedBonus)))`).
  - `housingCapacity` -> `housingCapacityBonus` (tope `TECH_EFFECT_CAPS.housingCapacity = 0.30`): consumido en `calculateResidentialCapacity` desde `buildings.ts`, `economy.ts` y `economyAdapter.ts`.

---

## 2. Catálogo Exacto de las 56 Investigaciones Nuevas

### 2.1. Las 20 Investigaciones Universales Nuevas (Niveles 6–8)

| ID | Nombre exacto | Rama | Civilización | Univ | Oro | Madera | Piedra | Hierro | Comida | Duración (s) | Requisitos tecnológicos | Requisitos de edificios | Efectos y valores | Tope aplicable |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `mining_10` | Ruedas de desagüe y pozos profundos | `economica` | Universal (ninguna) | 6 | 2600 | 850 | 800 | 320 | 0 | 1200 | `mining_8` | castillo: 8, universidad: 6, minaHierro: 6 | miningProduction: +0.08 | TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %) |
| `mining_11` | Bosques de ordenación y sierra doble | `economica` | Universal (ninguna) | 7 | 3400 | 1050 | 1000 | 400 | 0 | 1500 | `mining_10` | castillo: 9, universidad: 7, aserradero: 7, cantera: 7 | woodProduction: +0.1; stoneProduction: +0.1 | TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %) |
| `mining_12` | Forjas hidráulicas de martinete | `economica` | Universal (ninguna) | 8 | 4500 | 1300 | 1250 | 550 | 0 | 1800 | `mining_11`, `mining_9` | castillo: 10, universidad: 8, minaHierro: 8, herreria: 7 | ironProduction: +0.1; goldProduction: +0.06 | TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %) |
| `storage_4` | Depósitos reales y cilla metropolitana | `economica` | Universal (ninguna) | 6 | 2650 | 900 | 850 | 280 | 0 | 1200 | `storage_3`, `agri_8` | castillo: 8, universidad: 6, mercado: 6 | storageCapacity: +0.18; foodConsumption: -0.03 | TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %) |
| `trade_5` | Compañías mercantiles y letras reales | `economica` | Universal (ninguna) | 8 | 4600 | 1350 | 1300 | 480 | 0 | 1800 | `trade_4`, `storage_4`, `merc_2` | castillo: 10, universidad: 8, mercado: 8, taberna: 6 | storageCapacity: +0.15; mercenaryCost: -0.08 | TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.mercenaryCost = 0.30 (-30 %) |
| `housing_1` | Ensanches de arrabal y parcelas urbanas | `civil` | Universal (ninguna) | 6 | 2550 | 900 | 850 | 260 | 0 | 1200 | `construction_5` | castillo: 8, universidad: 6, viviendas: 8 | housingCapacity: +0.06 | TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %) |
| `housing_2` | Obras hidráulicas y alcantarillado urbano | `civil` | Universal (ninguna) | 6 | 2700 | 920 | 900 | 280 | 0 | 1200 | `housing_1`, `medicine_3` | castillo: 8, universidad: 6, viviendas: 8 | housingCapacity: +0.06; constructionDuration: -0.03 | TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %) |
| `housing_3` | Casas consistoriales y ordenanza urbana | `civil` | Universal (ninguna) | 7 | 3450 | 1100 | 1080 | 360 | 0 | 1500 | `housing_2`, `happiness_6` | castillo: 9, universidad: 7, viviendas: 9 | housingCapacity: +0.06; happinessBase: +1 | TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts) |
| `construction_9` | Arquitectura civil de bóvedas | `civil` | Universal (ninguna) | 7 | 3550 | 1150 | 1200 | 390 | 0 | 1500 | `construction_8`, `housing_2` | castillo: 9, universidad: 7, cantera: 8 | constructionDuration: -0.05 | TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %) |
| `housing_4` | Planificación de grandes metrópolis | `civil` | Universal (ninguna) | 8 | 4650 | 1400 | 1450 | 500 | 0 | 1800 | `housing_3`, `construction_9`, `happiness_7` | castillo: 10, universidad: 8, viviendas: 10 | housingCapacity: +0.06; happinessBase: +1 | TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts) |
| `siege_1` | Artillería de campaña y balística | `militar` | Universal (ninguna) | 6 | 2700 | 900 | 850 | 420 | 0 | 1200 | `tactics_all`, `advanced_steel` | castillo: 8, universidad: 6, cuartel: 6, herreria: 6 | unitEfficiencySiege: +0.08 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `siege_2` | Maestros ingenieros de sitio | `militar` | Universal (ninguna) | 7 | 3600 | 1150 | 1100 | 540 | 0 | 1500 | `siege_1` | castillo: 9, universidad: 7, cuartel: 7, herreria: 7 | unitEfficiencySiege: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `training_6` | Escuelas de suboficiales y reclutamiento | `militar` | Universal (ninguna) | 6 | 2750 | 850 | 750 | 380 | 0 | 1200 | `training_5` | castillo: 8, universidad: 6, cuartel: 7 | trainingDuration: -0.06 | TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %) |
| `medical_6` | Cuerpo sanitario de retaguardia | `militar` | Universal (ninguna) | 7 | 3500 | 950 | 950 | 400 | 0 | 1500 | `medical_5` | castillo: 9, universidad: 7, hospitalMilitar: 6 | woundedRate: +0.05; woundedRecovery: +0.05 | TECH_EFFECT_CAPS.woundedRate = 0.20 (+20 pp); TECH_EFFECT_CAPS.woundedRecovery = 0.60 (+60 pp) |
| `logistics_7` | Cuerpo de bagajes y campaña profunda | `militar` | Universal (ninguna) | 8 | 4700 | 1300 | 1200 | 600 | 0 | 1800 | `logistics_6`, `training_6` | castillo: 10, universidad: 8, cuartel: 8 | fatigueAccrual: -0.08; marchFatigue: -0.05; trainingDuration: -0.05 | TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %) |
| `spy_5` | Cancillería cifrada y red de informadores | `inteligencia` | Universal (ninguna) | 6 | 2800 | 850 | 800 | 320 | 0 | 1200 | `spy_4`, `espionage_4` | castillo: 8, universidad: 6, parlamento: 4 | espionageCost: -0.1; counterEspionage: +0.06 | TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %) |
| `spy_6` | Cartografía astronómica y portulanos | `inteligencia` | Universal (ninguna) | 6 | 2700 | 900 | 750 | 280 | 0 | 1200 | `spy_2`, `espionage_3` | castillo: 8, universidad: 6 | explorationSpeed: +0.12; explorationCost: -0.08 | TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %) |
| `spy_7` | Correos encubiertos y enlaces clandestinos | `inteligencia` | Universal (ninguna) | 7 | 3600 | 1100 | 1000 | 400 | 0 | 1500 | `spy_5`, `spy_6` | castillo: 9, universidad: 7, parlamento: 5 | espionageCost: -0.12; explorationCost: -0.1 | TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %) |
| `spy_8` | Vanguardia de descubierta y agrimensores | `inteligencia` | Universal (ninguna) | 7 | 3500 | 1100 | 950 | 380 | 0 | 1500 | `spy_6` | castillo: 9, universidad: 7 | explorationSpeed: +0.13; marchSpeed: +0.05 | TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %) |
| `spy_9` | Consejo supremo de inteligencia | `inteligencia` | Universal (ninguna) | 8 | 4800 | 1350 | 1250 | 520 | 0 | 1800 | `spy_7`, `spy_8` | castillo: 10, universidad: 8, parlamento: 6 | counterEspionage: +0.1; espionageCost: -0.08; explorationSpeed: +0.1 | TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %); TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %) |

### 2.2. Las 36 Investigaciones Exclusivas Nuevas (3 × 12 Civilizaciones, Niveles 6–8)

| ID | Nombre exacto | Rama | Civilización | Univ | Oro | Madera | Piedra | Hierro | Comida | Duración (s) | Requisitos tecnológicos | Requisitos de edificios | Efectos y valores | Tope aplicable |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `tech_civ_ingleses_d` | Bosques reales y astilleros | `civilizacion` | `ingleses` (Ingleses) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_ingleses_c` | castillo: 6, universidad: 6 | woodProduction: +0.1 | TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %) |
| `tech_civ_ingleses_e` | Tiro de andanada y paveses | `civilizacion` | `ingleses` (Ingleses) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_ingleses_d` | castillo: 7, universidad: 7 | unitEfficiencyArc: +0.08 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_ingleses_f` | Trabuquetes de la Corona | `civilizacion` | `ingleses` (Ingleses) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_ingleses_e` | castillo: 8, universidad: 8 | unitEfficiencySiege: +0.1; combatDefense: +0.05 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %) |
| `tech_civ_romanos_d` | Canteras del Imperio | `civilizacion` | `romanos` (Romanos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_romanos_c` | castillo: 6, universidad: 6 | stoneProduction: +0.1 | TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %) |
| `tech_civ_romanos_e` | Cuerpos de balistarios y onagros | `civilizacion` | `romanos` (Romanos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_romanos_d` | castillo: 7, universidad: 7 | unitEfficiencySiege: +0.12 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_romanos_f` | Pax Romana e ingeniería de fronteras | `civilizacion` | `romanos` (Romanos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_romanos_e` | castillo: 8, universidad: 8 | combatDefense: +0.08; marchFatigue: -0.08 | TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %) |
| `tech_civ_griegos_d` | Ligas marítimas y moneda ática | `civilizacion` | `griegos` (Griegos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_griegos_c` | castillo: 6, universidad: 6 | goldProduction: +0.1 | TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %) |
| `tech_civ_griegos_e` | Ágora y teatro cívico | `civilizacion` | `griegos` (Griegos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_griegos_d` | castillo: 7, universidad: 7 | happinessBase: +4; housingCapacity: +0.05 | TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %) |
| `tech_civ_griegos_f` | Estrategas de la Hélade | `civilizacion` | `griegos` (Griegos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_griegos_e` | castillo: 8, universidad: 8 | combatDefense: +0.08; unitEfficiencyInf: +0.06 | TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_vikingos_d` | Cartografía de alta mar | `civilizacion` | `vikingos` (Vikingos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_vikingos_c` | castillo: 6, universidad: 6 | explorationSpeed: +0.15; explorationCost: -0.1 | TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %) |
| `tech_civ_vikingos_e` | Húscarles de la guardia real | `civilizacion` | `vikingos` (Vikingos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_vikingos_d` | castillo: 7, universidad: 7 | unitEfficiencyInf: +0.08 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_vikingos_f` | Rutas del Báltico y almacenes del norte | `civilizacion` | `vikingos` (Vikingos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_vikingos_e` | castillo: 8, universidad: 8 | storageCapacity: +0.12; goldProduction: +0.08 | TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %) |
| `tech_civ_bizantinos_d` | Oficina de los Bárbaros | `civilizacion` | `bizantinos` (Bizantinos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_bizantinos_c` | castillo: 6, universidad: 6 | espionageCost: -0.1; counterEspionage: +0.07 | TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %) |
| `tech_civ_bizantinos_e` | Sifones de fuego griego y helépolis | `civilizacion` | `bizantinos` (Bizantinos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_bizantinos_d` | castillo: 7, universidad: 7 | unitEfficiencySiege: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_bizantinos_f` | Cuerpo de catafractos de la Guardia | `civilizacion` | `bizantinos` (Bizantinos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_bizantinos_e` | castillo: 8, universidad: 8 | unitEfficiencyCav: +0.05; combatDefense: +0.04 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %) |
| `tech_civ_arabes_d` | Norias hidráulicas y oasis | `civilizacion` | `arabes` (Árabes) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_arabes_c` | castillo: 6, universidad: 6 | agricultureProduction: +0.12 | TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %) |
| `tech_civ_arabes_e` | Caballería del Califato | `civilizacion` | `arabes` (Árabes) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_arabes_d` | castillo: 7, universidad: 7 | unitEfficiencyCav: +0.07; marchSpeed: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %) |
| `tech_civ_arabes_f` | Alquimia, medicina y tratados de asedio | `civilizacion` | `arabes` (Árabes) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_arabes_e` | castillo: 8, universidad: 8 | unitEfficiencySiege: +0.1; combatAttack: +0.06 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %) |
| `tech_civ_mongoles_d` | Estribos reforzados y relevos de monta | `civilizacion` | `mongoles` (Mongoles) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_mongoles_c` | castillo: 6, universidad: 6 | marchFatigue: -0.15; marchSpeed: +0.05 | TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %) |
| `tech_civ_mongoles_e` | Cuerpo de ingenieros de asedio de la Horda | `civilizacion` | `mongoles` (Mongoles) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_mongoles_d` | castillo: 7, universidad: 7 | unitEfficiencySiege: +0.12 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_mongoles_f` | Tácticas de cerco del Gran Kan | `civilizacion` | `mongoles` (Mongoles) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_mongoles_e` | castillo: 8, universidad: 8 | combatAttack: +0.12 | TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %) |
| `tech_civ_chinos_d` | Terrazas de arroz y canales imperiales | `civilizacion` | `chinos` (Chinos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_chinos_c` | castillo: 6, universidad: 6 | agricultureProduction: +0.12; housingCapacity: +0.06 | TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %) |
| `tech_civ_chinos_e` | Cuerpo de ballesteros y cohetes de pólvora | `civilizacion` | `chinos` (Chinos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_chinos_d` | castillo: 7, universidad: 7 | unitEfficiencyArc: +0.08; unitEfficiencySiege: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_chinos_f` | Murallas de los Diez Mil Li | `civilizacion` | `chinos` (Chinos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_chinos_e` | castillo: 8, universidad: 8 | combatDefense: +0.1 | TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %) |
| `tech_civ_japoneses_d` | Forjas de tatara y minería profunda | `civilizacion` | `japoneses` (Japoneses) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_japoneses_c` | castillo: 6, universidad: 6 | ironProduction: +0.1; miningProduction: +0.08 | TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %) |
| `tech_civ_japoneses_e` | Cuerpo de shinobi y espionaje de clanes | `civilizacion` | `japoneses` (Japoneses) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_japoneses_d` | castillo: 7, universidad: 7 | espionageCost: -0.1; counterEspionage: +0.07 | TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %) |
| `tech_civ_japoneses_f` | Guardia Hatamoto y filas de élite | `civilizacion` | `japoneses` (Japoneses) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_japoneses_e` | castillo: 8, universidad: 8 | unitEfficiencyInf: +0.09; combatDefense: +0.08 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %) |
| `tech_civ_navajos_d` | Vías secretas del cañón | `civilizacion` | `navajos` (Navajos) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_navajos_c` | castillo: 6, universidad: 6 | explorationCost: -0.15; explorationSpeed: +0.12 | TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %) |
| `tech_civ_navajos_e` | Arqueros silenciosos del bosque | `civilizacion` | `navajos` (Navajos) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_navajos_d` | castillo: 7, universidad: 7 | unitEfficiencyArc: +0.12; woodProduction: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %) |
| `tech_civ_navajos_f` | Señores del horizonte y la espesura | `civilizacion` | `navajos` (Navajos) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_navajos_e` | castillo: 8, universidad: 8 | marchSpeed: +0.1; combatAttack: +0.08 | TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %) |
| `tech_civ_aztecas_d` | Acueductos de Chapultepec y sustento | `civilizacion` | `aztecas` (Aztecas) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_aztecas_c` | castillo: 6, universidad: 6 | agricultureProduction: +0.08; housingCapacity: +0.06 | TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %) |
| `tech_civ_aztecas_e` | Órdenes guerreras de élite | `civilizacion` | `aztecas` (Aztecas) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_aztecas_d` | castillo: 7, universidad: 7 | unitEfficiencyInf: +0.07; unitEfficiencyCav: +0.1 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %) |
| `tech_civ_aztecas_f` | Supremacía de la Triple Alianza | `civilizacion` | `aztecas` (Aztecas) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_aztecas_e` | castillo: 8, universidad: 8 | combatAttack: +0.1; fatigueAccrual: -0.08 | TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %) |
| `tech_civ_masais_d` | Pastoreo estacional y ahorro de grano | `civilizacion` | `masais` (Masáis) | 6 | 2400 | 850 | 800 | 450 | 0 | 1200 | `tech_civ_masais_c` | castillo: 6, universidad: 6 | foodConsumption: -0.02; fatigueAccrual: -0.1 | TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %) |
| `tech_civ_masais_e` | Lanzas Ol-alem y escudos de búfalo | `civilizacion` | `masais` (Masáis) | 7 | 3200 | 1100 | 1050 | 600 | 0 | 1500 | `tech_civ_masais_d` | castillo: 7, universidad: 7 | unitEfficiencyInf: +0.07; combatDefense: +0.08 | TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %) |
| `tech_civ_masais_f` | Incursiones veloces de la sabana | `civilizacion` | `masais` (Masáis) | 8 | 4200 | 1400 | 1350 | 800 | 0 | 1800 | `tech_civ_masais_e` | castillo: 8, universidad: 8 | marchSpeed: +0.12; combatAttack: +0.1 | TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %) |

---

## 3. Justificación Matemática Individual (56 / 56 Investigaciones)

Todas las investigaciones de esta ampliación utilizan costes definidos estáticamente en `TECHNOLOGIES` (`convex/balanceConfig.ts`). A continuación se presenta la justificación matemática verificable de cada una de las 56 tecnologías, comparándola con sus predecesoras inmediatas, su coste por punto de efecto y su duración real mediante `computeResearchDuration`.

### 3.1.1. Rama Económica (5 universales)

#### `mining_10` — Ruedas de desagüe y pozos profundos
1. **Posición en progresión:** Nodo avanzado de la rama **Económica** (`branch: "economica"`), sucesora directa de `mining_8` (Univ 5, oro 1100, total 2270, 720 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, minaHierro: 6`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4570** recursos totales: `2600/850/800/320/0`). Frente a la predecesora más costosa de su cadena (`mining_8`, Univ 5, oro `1100`, total `2270`), aplica un factor de progresión de **×2.013** en recursos totales y **×2.364** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: miningProduction (8 % -> 571.3 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `720 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1300` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %)`.

#### `mining_11` — Bosques de ordenación y sierra doble
1. **Posición en progresión:** Nodo avanzado de la rama **Económica** (`branch: "economica"`), sucesora directa de `mining_10` (Univ 6, oro 2600, total 4570, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, aserradero: 7, cantera: 7`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**5850** recursos totales: `3400/1050/1000/400/0`). Frente a la predecesora más costosa de su cadena (`mining_10`, Univ 6, oro `2600`, total `4570`), aplica un factor de progresión de **×1.280** en recursos totales y **×1.308** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: woodProduction (10 % -> 585.0 rec/pp); stoneProduction (10 % -> 585.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1700` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %)`.

#### `mining_12` — Forjas hidráulicas de martinete
1. **Posición en progresión:** Nodo avanzado de la rama **Económica** (`branch: "economica"`), sucesora directa de `mining_11` (Univ 7, oro 3400, total 5850, 1500 s) y `mining_9` (Univ 5, oro 1100, total 2270, 720 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 10, universidad: 8, minaHierro: 8, herreria: 7`; profundidad exacta en el grafo de dependencias: **7** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**7600** recursos totales: `4500/1300/1250/550/0`). Frente a la predecesora más costosa de su cadena (`mining_11`, Univ 7, oro `3400`, total `5850`), aplica un factor de progresión de **×1.299** en recursos totales y **×1.324** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: ironProduction (10 % -> 760.0 rec/pp); goldProduction (6 % -> 1266.7 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2250` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %)`.

#### `storage_4` — Depósitos reales y cilla metropolitana
1. **Posición en progresión:** Nodo avanzado de la rama **Económica** (`branch: "economica"`), sucesora directa de `storage_3` (Univ 5, oro 1100, total 2270, 720 s) y `agri_8` (Univ 5, oro 1800, total 3550, 1080 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, mercado: 6`; profundidad exacta en el grafo de dependencias: **7** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4680** recursos totales: `2650/900/850/280/0`). Frente a la predecesora más costosa de su cadena (`agri_8`, Univ 5, oro `1800`, total `3550`), aplica un factor de progresión de **×1.318** en recursos totales y **×1.472** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: storageCapacity (18 % -> 260.0 rec/pp); foodConsumption (3 % -> 1560.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `1080 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1325` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %)`.

#### `trade_5` — Compañías mercantiles y letras reales
1. **Posición en progresión:** Nodo avanzado de la rama **Económica** (`branch: "economica"`), sucesora directa de `trade_4` (Univ 5, oro 1430, total 2300, 720 s) y `storage_4` (Univ 6, oro 2650, total 4680, 1200 s) y `merc_2` (Univ 5, oro 1100, total 1990, 720 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 10, universidad: 8, mercado: 8, taberna: 6`; profundidad exacta en el grafo de dependencias: **8** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**7730** recursos totales: `4600/1350/1300/480/0`). Frente a la predecesora más costosa de su cadena (`storage_4`, Univ 6, oro `2650`, total `4680`), aplica un factor de progresión de **×1.652** en recursos totales y **×1.736** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: storageCapacity (15 % -> 515.3 rec/pp); mercenaryCost (8 % -> 966.3 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.mercenaryCost = 0.30 (-30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2300` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.mercenaryCost = 0.30 (-30 %)`.

### 3.1.2. Rama Civil (5 universales)

#### `housing_1` — Ensanches de arrabal y parcelas urbanas
1. **Posición en progresión:** Nodo avanzado de la rama **Civil** (`branch: "civil"`), sucesora directa de `construction_5` (Univ 4, oro 800, total 1680, 480 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, viviendas: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4560** recursos totales: `2550/900/850/260/0`). Frente a la predecesora más costosa de su cadena (`construction_5`, Univ 4, oro `800`, total `1680`), aplica un factor de progresión de **×2.714** en recursos totales y **×3.188** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: housingCapacity (6 % -> 760.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 4 de `480 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1275` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %)`.

#### `housing_2` — Obras hidráulicas y alcantarillado urbano
1. **Posición en progresión:** Nodo avanzado de la rama **Civil** (`branch: "civil"`), sucesora directa de `housing_1` (Univ 6, oro 2550, total 4560, 1200 s) y `medicine_3` (Univ 3, oro 400, total 810, 360 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, viviendas: 8`; profundidad exacta en el grafo de dependencias: **7** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4800** recursos totales: `2700/920/900/280/0`). Frente a la predecesora más costosa de su cadena (`housing_1`, Univ 6, oro `2550`, total `4560`), aplica un factor de progresión de **×1.053** en recursos totales y **×1.059** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: housingCapacity (6 % -> 800.0 rec/pp); constructionDuration (3 % -> 1600.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1350` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %)`.

#### `housing_3` — Casas consistoriales y ordenanza urbana
1. **Posición en progresión:** Nodo avanzado de la rama **Civil** (`branch: "civil"`), sucesora directa de `housing_2` (Univ 6, oro 2700, total 4800, 1200 s) y `happiness_6` (Univ 4, oro 650, total 1440, 480 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, viviendas: 9`; profundidad exacta en el grafo de dependencias: **8** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**5990** recursos totales: `3450/1100/1080/360/0`). Frente a la predecesora más costosa de su cadena (`housing_2`, Univ 6, oro `2700`, total `4800`), aplica un factor de progresión de **×1.248** en recursos totales y **×1.278** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: housingCapacity (6 % -> 998.3 rec/pp); happinessBase (1 pt -> 5990.0 rec/pt). Tope aplicable: TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1725` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts)`.

#### `construction_9` — Arquitectura civil de bóvedas
1. **Posición en progresión:** Nodo avanzado de la rama **Civil** (`branch: "civil"`), sucesora directa de `construction_8` (Univ 5, oro 1800, total 3780, 1080 s) y `housing_2` (Univ 6, oro 2700, total 4800, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, cantera: 8`; profundidad exacta en el grafo de dependencias: **9** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**6290** recursos totales: `3550/1150/1200/390/0`). Frente a la predecesora más costosa de su cadena (`housing_2`, Univ 6, oro `2700`, total `4800`), aplica un factor de progresión de **×1.310** en recursos totales y **×1.315** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: constructionDuration (5 % -> 1258.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1775` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.constructionDurationFloor = 0.60 (máx. -40 %)`.

#### `housing_4` — Planificación de grandes metrópolis
1. **Posición en progresión:** Nodo avanzado de la rama **Civil** (`branch: "civil"`), sucesora directa de `housing_3` (Univ 7, oro 3450, total 5990, 1500 s) y `construction_9` (Univ 7, oro 3550, total 6290, 1500 s) y `happiness_7` (Univ 5, oro 1800, total 3780, 1080 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 10, universidad: 8, viviendas: 10`; profundidad exacta en el grafo de dependencias: **10** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**8000** recursos totales: `4650/1400/1450/500/0`). Frente a la predecesora más costosa de su cadena (`construction_9`, Univ 7, oro `3550`, total `6290`), aplica un factor de progresión de **×1.272** en recursos totales y **×1.310** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: housingCapacity (6 % -> 1333.3 rec/pp); happinessBase (1 pt -> 8000.0 rec/pt). Tope aplicable: TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2325` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %); TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts)`.

### 3.1.3. Rama Militar (5 universales)

#### `siege_1` — Artillería de campaña y balística
1. **Posición en progresión:** Nodo avanzado de la rama **Militar** (`branch: "militar"`), sucesora directa de `tactics_all` (Univ 5, oro 1800, total 3240, 1080 s) y `advanced_steel` (Univ 3, oro 600, total 1250, 480 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, cuartel: 6, herreria: 6`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4870** recursos totales: `2700/900/850/420/0`). Frente a la predecesora más costosa de su cadena (`tactics_all`, Univ 5, oro `1800`, total `3240`), aplica un factor de progresión de **×1.503** en recursos totales y **×1.500** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (8 % -> 608.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `1080 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1350` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `siege_2` — Maestros ingenieros de sitio
1. **Posición en progresión:** Nodo avanzado de la rama **Militar** (`branch: "militar"`), sucesora directa de `siege_1` (Univ 6, oro 2700, total 4870, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, cuartel: 7, herreria: 7`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**6390** recursos totales: `3600/1150/1100/540/0`). Frente a la predecesora más costosa de su cadena (`siege_1`, Univ 6, oro `2700`, total `4870`), aplica un factor de progresión de **×1.312** en recursos totales y **×1.333** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (10 % -> 639.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1800` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `training_6` — Escuelas de suboficiales y reclutamiento
1. **Posición en progresión:** Nodo avanzado de la rama **Militar** (`branch: "militar"`), sucesora directa de `training_5` (Univ 5, oro 1100, total 1990, 720 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, cuartel: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4730** recursos totales: `2750/850/750/380/0`). Frente a la predecesora más costosa de su cadena (`training_5`, Univ 5, oro `1100`, total `1990`), aplica un factor de progresión de **×2.377** en recursos totales y **×2.500** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: trainingDuration (6 % -> 788.3 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `720 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1375` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %)`.

#### `medical_6` — Cuerpo sanitario de retaguardia
1. **Posición en progresión:** Nodo avanzado de la rama **Militar** (`branch: "militar"`), sucesora directa de `medical_5` (Univ 5, oro 1800, total 3370, 1080 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, hospitalMilitar: 6`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**5800** recursos totales: `3500/950/950/400/0`). Frente a la predecesora más costosa de su cadena (`medical_5`, Univ 5, oro `1800`, total `3370`), aplica un factor de progresión de **×1.721** en recursos totales y **×1.944** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: woundedRate (5 % -> 1160.0 rec/pp); woundedRecovery (5 % -> 1160.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.woundedRate = 0.20 (+20 pp); TECH_EFFECT_CAPS.woundedRecovery = 0.60 (+60 pp).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 5 de `1080 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1750` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.woundedRate = 0.20 (+20 pp); TECH_EFFECT_CAPS.woundedRecovery = 0.60 (+60 pp)`.

#### `logistics_7` — Cuerpo de bagajes y campaña profunda
1. **Posición en progresión:** Nodo avanzado de la rama **Militar** (`branch: "militar"`), sucesora directa de `logistics_6` (Univ 5, oro 1800, total 3240, 1080 s) y `training_6` (Univ 6, oro 2750, total 4730, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 10, universidad: 8, cuartel: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**7800** recursos totales: `4700/1300/1200/600/0`). Frente a la predecesora más costosa de su cadena (`training_6`, Univ 6, oro `2750`, total `4730`), aplica un factor de progresión de **×1.649** en recursos totales y **×1.709** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: fatigueAccrual (8 % -> 975.0 rec/pp); marchFatigue (5 % -> 1560.0 rec/pp); trainingDuration (5 % -> 1560.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2350` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.trainingDurationFloor = 0.60 (máx. -40 %)`.

### 3.1.4. Rama Inteligencia (5 universales)

#### `spy_5` — Cancillería cifrada y red de informadores
1. **Posición en progresión:** Nodo avanzado de la rama **Inteligencia** (`branch: "inteligencia"`), sucesora directa de `spy_4` (Univ 5, oro 2100, total 3620, 1080 s) y `espionage_4` (Univ 5, oro 2340, total 3910, 1080 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6, parlamento: 4`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4770** recursos totales: `2800/850/800/320/0`). Frente a la predecesora más costosa de su cadena (`espionage_4`, Univ 5, oro `2340`, total `3910`), aplica un factor de progresión de **×1.220** en recursos totales y **×1.197** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: espionageCost (10 % -> 477.0 rec/pp); counterEspionage (6 % -> 795.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `1080 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1400` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %)`.

#### `spy_6` — Cartografía astronómica y portulanos
1. **Posición en progresión:** Nodo avanzado de la rama **Inteligencia** (`branch: "inteligencia"`), sucesora directa de `spy_2` (Univ 3, oro 480, total 860, 360 s) y `espionage_3` (Univ 4, oro 800, total 1510, 480 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 8, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**4630** recursos totales: `2700/900/750/280/0`). Frente a la predecesora más costosa de su cadena (`espionage_3`, Univ 4, oro `800`, total `1510`), aplica un factor de progresión de **×3.066** en recursos totales y **×3.375** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: explorationSpeed (12 % -> 385.8 rec/pp); explorationCost (8 % -> 578.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 4 de `480 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1350` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %)`.

#### `spy_7` — Correos encubiertos y enlaces clandestinos
1. **Posición en progresión:** Nodo avanzado de la rama **Inteligencia** (`branch: "inteligencia"`), sucesora directa de `spy_5` (Univ 6, oro 2800, total 4770, 1200 s) y `spy_6` (Univ 6, oro 2700, total 4630, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7, parlamento: 5`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**6100** recursos totales: `3600/1100/1000/400/0`). Frente a la predecesora más costosa de su cadena (`spy_5`, Univ 6, oro `2800`, total `4770`), aplica un factor de progresión de **×1.279** en recursos totales y **×1.286** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: espionageCost (12 % -> 508.3 rec/pp); explorationCost (10 % -> 610.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1800` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %)`.

#### `spy_8` — Vanguardia de descubierta y agrimensores
1. **Posición en progresión:** Nodo avanzado de la rama **Inteligencia** (`branch: "inteligencia"`), sucesora directa de `spy_6` (Univ 6, oro 2700, total 4630, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 9, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**5930** recursos totales: `3500/1100/950/380/0`). Frente a la predecesora más costosa de su cadena (`spy_6`, Univ 6, oro `2700`, total `4630`), aplica un factor de progresión de **×1.281** en recursos totales y **×1.296** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: explorationSpeed (13 % -> 456.2 rec/pp); marchSpeed (5 % -> 1186.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1750` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %)`.

#### `spy_9` — Consejo supremo de inteligencia
1. **Posición en progresión:** Nodo avanzado de la rama **Inteligencia** (`branch: "inteligencia"`), sucesora directa de `spy_7` (Univ 7, oro 3600, total 6100, 1500 s) y `spy_8` (Univ 7, oro 3500, total 5930, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 10, universidad: 8, parlamento: 6`; profundidad exacta en el grafo de dependencias: **7** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático definido literalmente en `TECHNOLOGIES` (**7920** recursos totales: `4800/1350/1250/520/0`). Frente a la predecesora más costosa de su cadena (`spy_7`, Univ 7, oro `3600`, total `6100`), aplica un factor de progresión de **×1.298** en recursos totales y **×1.333** en oro, en línea con los nodos equivalentes del mismo nivel de Universidad.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: counterEspionage (10 % -> 792.0 rec/pp); espionageCost (8 % -> 990.0 rec/pp); explorationSpeed (10 % -> 792.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %); TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2400` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %); TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %)`.

### 3.2. Exclusivas de las 12 Civilizaciones (36 nodos: `_d`, `_e`, `_f`)

#### Civilización: Ingleses (`ingleses`)

#### `tech_civ_ingleses_d` — Bosques reales y astilleros
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Ingleses** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_ingleses_c` (Univ 5, oro 1200, total 2700, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_ingleses_c` (Univ 5, oro `1200`, total `2700`), supone un incremento de **×1.667** en coste total y **×2.000** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: woodProduction (10 % -> 450.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %)`.

#### `tech_civ_ingleses_e` — Tiro de andanada y paveses
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Ingleses** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_ingleses_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_ingleses_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyArc (8 % -> 743.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_ingleses_f` — Trabuquetes de la Corona
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Ingleses** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_ingleses_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_ingleses_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (10 % -> 775.0 rec/pp); combatDefense (5 % -> 1550.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %)`.

#### Civilización: Romanos (`romanos`)

#### `tech_civ_romanos_d` — Canteras del Imperio
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Romanos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_romanos_c` (Univ 5, oro 1500, total 3200, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_romanos_c` (Univ 5, oro `1500`, total `3200`), supone un incremento de **×1.406** en coste total y **×1.600** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: stoneProduction (10 % -> 450.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.stoneProduction = 0.30 (+30 %)`.

#### `tech_civ_romanos_e` — Cuerpos de balistarios y onagros
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Romanos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_romanos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_romanos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (12 % -> 495.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_romanos_f` — Pax Romana e ingeniería de fronteras
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Romanos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_romanos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_romanos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: combatDefense (8 % -> 968.8 rec/pp); marchFatigue (8 % -> 968.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %)`.

#### Civilización: Griegos (`griegos`)

#### `tech_civ_griegos_d` — Ligas marítimas y moneda ática
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Griegos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_griegos_c` (Univ 5, oro 1400, total 3260, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_griegos_c` (Univ 5, oro `1400`, total `3260`), supone un incremento de **×1.380** en coste total y **×1.714** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: goldProduction (10 % -> 450.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %)`.

#### `tech_civ_griegos_e` — Ágora y teatro cívico
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Griegos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_griegos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_griegos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: happinessBase (4 pt -> 1487.5 rec/pt); housingCapacity (5 % -> 1190.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.happinessBase = 30 (+30 pts); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %)`.

#### `tech_civ_griegos_f` — Estrategas de la Hélade
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Griegos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_griegos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_griegos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: combatDefense (8 % -> 968.8 rec/pp); unitEfficiencyInf (6 % -> 1291.7 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %); TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### Civilización: Vikingos (`vikingos`)

#### `tech_civ_vikingos_d` — Cartografía de alta mar
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Vikingos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_vikingos_c` (Univ 5, oro 1600, total 2900, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_vikingos_c` (Univ 5, oro `1600`, total `2900`), supone un incremento de **×1.552** en coste total y **×1.500** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: explorationSpeed (15 % -> 300.0 rec/pp); explorationCost (10 % -> 450.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %); TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %)`.

#### `tech_civ_vikingos_e` — Húscarles de la guardia real
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Vikingos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_vikingos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_vikingos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyInf (8 % -> 743.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_vikingos_f` — Rutas del Báltico y almacenes del norte
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Vikingos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_vikingos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_vikingos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: storageCapacity (12 % -> 645.8 rec/pp); goldProduction (8 % -> 968.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.storageCapacity = 1.00 (+100 %); TECH_EFFECT_CAPS.goldProduction = 0.60 (+60 %)`.

#### Civilización: Bizantinos (`bizantinos`)

#### `tech_civ_bizantinos_d` — Oficina de los Bárbaros
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Bizantinos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_bizantinos_c` (Univ 5, oro 1800, total 3500, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_bizantinos_c` (Univ 5, oro `1800`, total `3500`), supone un incremento de **×1.286** en coste total y **×1.333** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: espionageCost (10 % -> 450.0 rec/pp); counterEspionage (7 % -> 642.9 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %)`.

#### `tech_civ_bizantinos_e` — Sifones de fuego griego y helépolis
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Bizantinos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_bizantinos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_bizantinos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (10 % -> 595.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_bizantinos_f` — Cuerpo de catafractos de la Guardia
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Bizantinos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_bizantinos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_bizantinos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyCav (5 % -> 1550.0 rec/pp); combatDefense (4 % -> 1937.5 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %)`.

#### Civilización: Árabes (`arabes`)

#### `tech_civ_arabes_d` — Norias hidráulicas y oasis
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Árabes** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_arabes_c` (Univ 5, oro 1300, total 2400, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_arabes_c` (Univ 5, oro `1300`, total `2400`), supone un incremento de **×1.875** en coste total y **×1.846** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: agricultureProduction (12 % -> 375.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %)`.

#### `tech_civ_arabes_e` — Caballería del Califato
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Árabes** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_arabes_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_arabes_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyCav (7 % -> 850.0 rec/pp); marchSpeed (10 % -> 595.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %)`.

#### `tech_civ_arabes_f` — Alquimia, medicina y tratados de asedio
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Árabes** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_arabes_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_arabes_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (10 % -> 775.0 rec/pp); combatAttack (6 % -> 1291.7 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %)`.

#### Civilización: Mongoles (`mongoles`)

#### `tech_civ_mongoles_d` — Estribos reforzados y relevos de monta
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Mongoles** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_mongoles_c` (Univ 5, oro 1600, total 2900, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_mongoles_c` (Univ 5, oro `1600`, total `2900`), supone un incremento de **×1.552** en coste total y **×1.500** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: marchFatigue (15 % -> 300.0 rec/pp); marchSpeed (5 % -> 900.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.marchFatigue = 0.50 (-50 %); TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %)`.

#### `tech_civ_mongoles_e` — Cuerpo de ingenieros de asedio de la Horda
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Mongoles** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_mongoles_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_mongoles_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencySiege (12 % -> 495.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_mongoles_f` — Tácticas de cerco del Gran Kan
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Mongoles** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_mongoles_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_mongoles_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: combatAttack (12 % -> 645.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %)`.

#### Civilización: Chinos (`chinos`)

#### `tech_civ_chinos_d` — Terrazas de arroz y canales imperiales
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Chinos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_chinos_c` (Univ 5, oro 1800, total 3400, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_chinos_c` (Univ 5, oro `1800`, total `3400`), supone un incremento de **×1.324** en coste total y **×1.333** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: agricultureProduction (12 % -> 375.0 rec/pp); housingCapacity (6 % -> 750.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %)`.

#### `tech_civ_chinos_e` — Cuerpo de ballesteros y cohetes de pólvora
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Chinos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_chinos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_chinos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyArc (8 % -> 743.8 rec/pp); unitEfficiencySiege (10 % -> 595.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_chinos_f` — Murallas de los Diez Mil Li
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Chinos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_chinos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_chinos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: combatDefense (10 % -> 775.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %)`.

#### Civilización: Japoneses (`japoneses`)

#### `tech_civ_japoneses_d` — Forjas de tatara y minería profunda
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Japoneses** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_japoneses_c` (Univ 5, oro 2000, total 3800, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_japoneses_c` (Univ 5, oro `2000`, total `3800`), supone un incremento de **×1.184** en coste total y **×1.200** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: ironProduction (10 % -> 450.0 rec/pp); miningProduction (8 % -> 562.5 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.ironProduction = 0.30 (+30 %); TECH_EFFECT_CAPS.miningProduction = 0.50 (+50 %)`.

#### `tech_civ_japoneses_e` — Cuerpo de shinobi y espionaje de clanes
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Japoneses** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_japoneses_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_japoneses_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: espionageCost (10 % -> 595.0 rec/pp); counterEspionage (7 % -> 850.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.espionageCost = 0.40 (-40 %); TECH_EFFECT_CAPS.counterEspionage = 0.60 (+60 %)`.

#### `tech_civ_japoneses_f` — Guardia Hatamoto y filas de élite
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Japoneses** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_japoneses_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_japoneses_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyInf (9 % -> 861.1 rec/pp); combatDefense (8 % -> 968.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %)`.

#### Civilización: Navajos (`navajos`)

#### `tech_civ_navajos_d` — Vías secretas del cañón
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Navajos** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_navajos_c` (Univ 5, oro 1400, total 2800, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_navajos_c` (Univ 5, oro `1400`, total `2800`), supone un incremento de **×1.607** en coste total y **×1.714** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: explorationCost (15 % -> 300.0 rec/pp); explorationSpeed (12 % -> 375.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.explorationCost = 0.35 (-35 %); TECH_EFFECT_CAPS.explorationSpeed = 0.60 (+60 %)`.

#### `tech_civ_navajos_e` — Arqueros silenciosos del bosque
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Navajos** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_navajos_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_navajos_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyArc (12 % -> 495.8 rec/pp); woodProduction (10 % -> 595.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.woodProduction = 0.30 (+30 %)`.

#### `tech_civ_navajos_f` — Señores del horizonte y la espesura
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Navajos** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_navajos_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_navajos_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: marchSpeed (10 % -> 775.0 rec/pp); combatAttack (8 % -> 968.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %)`.

#### Civilización: Aztecas (`aztecas`)

#### `tech_civ_aztecas_d` — Acueductos de Chapultepec y sustento
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Aztecas** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_aztecas_c` (Univ 5, oro 1600, total 2800, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_aztecas_c` (Univ 5, oro `1600`, total `2800`), supone un incremento de **×1.607** en coste total y **×1.500** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: agricultureProduction (8 % -> 562.5 rec/pp); housingCapacity (6 % -> 750.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.agricultureProduction = 0.65 (+65 %); TECH_EFFECT_CAPS.housingCapacity = 0.30 (+30 %)`.

#### `tech_civ_aztecas_e` — Órdenes guerreras de élite
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Aztecas** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_aztecas_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_aztecas_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyInf (7 % -> 850.0 rec/pp); unitEfficiencyCav (10 % -> 595.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %)`.

#### `tech_civ_aztecas_f` — Supremacía de la Triple Alianza
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Aztecas** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_aztecas_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_aztecas_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: combatAttack (10 % -> 775.0 rec/pp); fatigueAccrual (8 % -> 968.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %)`.

#### Civilización: Masáis (`masais`)

#### `tech_civ_masais_d` — Pastoreo estacional y ahorro de grano
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Masáis** (rama `civilizacion`), ocupando el nodo `_d` tras `tech_civ_masais_c` (Univ 5, oro 1200, total 2300, 900 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **6** y edificios `castillo: 6, universidad: 6`; profundidad exacta en el grafo de dependencias: **4** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático de tier 6 exclusivo (**4500** recursos: `2400/850/800/450/0`). Frente a su predecesora directa `tech_civ_masais_c` (Univ 5, oro `1200`, total `2300`), supone un incremento de **×1.957** en coste total y **×2.000** en oro, homogeneizando las 12 civilizaciones al entrar en el tramo Avanzado.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: foodConsumption (2 % -> 2250.0 rec/pp); fatigueAccrual (10 % -> 450.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %).
5. **Coherencia de duración:** Pertenece al **Nivel 6 (Avanzado, base 1200 s = 20 min)** (superior a las predecesoras de Univ 5 de `900 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1200, techMul, civMul)`, la duración exacta es **1200 s** sin bonificación, **720 s** al tope universal (`techMul = 0.60`) y **648 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1200` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.foodConsumption = 0.15 (-15 %); TECH_EFFECT_CAPS.fatigueAccrual = 0.30 (-30 %)`.

#### `tech_civ_masais_e` — Lanzas Ol-alem y escudos de búfalo
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Masáis** (rama `civilizacion`), ocupando el nodo `_e` tras `tech_civ_masais_d` (Univ 6, oro 2400, total 4500, 1200 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **7** y edificios `castillo: 7, universidad: 7`; profundidad exacta en el grafo de dependencias: **5** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 7 exclusivo (**5950** recursos: `3200/1100/1050/600/0`). Frente a su predecesora inmediata `tech_civ_masais_d` (Univ 6, oro `2400`, total `4500`), mantiene exactamente el escalado **×1.322** en coste total y **×1.333** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: unitEfficiencyInf (7 % -> 850.0 rec/pp); combatDefense (8 % -> 743.8 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 7 (Superior, base 1500 s = 25 min)** (superior a las predecesoras de Univ 6 de `1200 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1500, techMul, civMul)`, la duración exacta es **1500 s** sin bonificación, **900 s** al tope universal (`techMul = 0.60`) y **810 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`1600` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.unitEfficiency = 0.30 (+30 %); TECH_EFFECT_CAPS.combatDefense = 0.25 (+25 %)`.

#### `tech_civ_masais_f` — Incursiones veloces de la sabana
1. **Posición en progresión:** Extensión de la cadena exclusiva de **Masáis** (rama `civilizacion`), ocupando el nodo `_f` tras `tech_civ_masais_e` (Univ 7, oro 3200, total 5950, 1500 s).
2. **Universidad y profundidad:** Requiere Universidad nivel **8** y edificios `castillo: 8, universidad: 8`; profundidad exacta en el grafo de dependencias: **6** niveles desde las raíces.
3. **Relación de coste con predecesoras:** Coste estático uniforme de tier 8 exclusivo (**7750** recursos: `4200/1400/1350/800/0`). Frente a su predecesora inmediata `tech_civ_masais_e` (Univ 7, oro `3200`, total `5950`), mantiene exactamente el escalado **×1.303** en coste total y **×1.313** en oro.
4. **Relación coste / potencia del efecto:** Coste por unidad de efecto: marchSpeed (12 % -> 645.8 rec/pp); combatAttack (10 % -> 775.0 rec/pp). Tope aplicable: TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %).
5. **Coherencia de duración:** Pertenece al **Nivel 8 (Maestría, base 1800 s = 30 min)** (superior a las predecesoras de Univ 7 de `1500 s`). Con `RESEARCH_TIME_SCALE = 1.0` en `computeResearchDuration(1800, techMul, civMul)`, la duración exacta es **1800 s** sin bonificación, **1080 s** al tope universal (`techMul = 0.60`) y **972 s** con pasiva árabe adicional (`civMul = 0.90`).
6. **Integración económica:** `createResearchPlan` deduce los costes literales sin modificar las fórmulas de producción ni almacenamiento, con reembolso del 50 % si se cancela (`2100` oro, redondeo `Math.floor`). Sus efectos se suman de forma aditiva e idempotente en `computeTechnologyModifiers` acotados por `TECH_EFFECT_CAPS.marchSpeed = 0.55 (+55 %); TECH_EFFECT_CAPS.combatAttack = 0.25 (+25 %)`.

---

## 4. Resumen Económico Global y Progresión

### 4.1. Comparativa: Universales Nuevas (20) vs Exclusivas Nuevas (36) vs Catálogo Completo (191)

| Conjunto | Nodos | Oro total | Madera total | Piedra total | Hierro total | Comida total | Recursos totales | Duración base acumulada (s) | Coste medio/nodo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Base previo (Niveles 1–5) | 135 | 95670 | 38690 | 35250 | 20040 | 0 | 189650 | 68625 | 1404.8 |
| Ampliación Universales (Niveles 6–8) | 20 | 69300 | 21370 | 20280 | 8060 | 0 | 119010 | 29100 | 5950.5 |
| Ampliación Exclusivas (Niveles 6–8) | 36 | 117600 | 40200 | 38400 | 22200 | 0 | 218400 | 54000 | 6066.7 |
| Total Ampliación (56 nuevas) | 56 | 186900 | 61570 | 58680 | 30260 | 0 | 337410 | 83100 | 6025.2 |
| Catálogo Completo (191 tecnologías) | 191 | 282570 | 100260 | 93930 | 50300 | 0 | 527060 | 151725 | 2759.5 |

### 4.2. Comparativa por las Cuatro Ramas Universales (Base 1–5 vs Ampliación 6–8)

| Rama | Base (N) | Base Oro | Base Total | Nuevas (N) | Nuevas Oro | Nuevas Madera | Nuevas Piedra | Nuevas Hierro | Nuevas Comida | Nuevas Total | Nuevas Dur. (s) | Total Rama (N) | Recursos Rama Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Económica (`economica`) | 26 | 16700 | 33440 | 5 | 17750 | 5450 | 5200 | 2030 | 0 | 30430 | 7500 | 31 | 63870 |
| Civil (`civil`) | 21 | 16090 | 32510 | 5 | 16900 | 5470 | 5480 | 1790 | 0 | 29640 | 7200 | 26 | 62150 |
| Militar (`militar`) | 32 | 22100 | 41500 | 5 | 17250 | 5150 | 4850 | 2340 | 0 | 29590 | 7200 | 37 | 71090 |
| Inteligencia (`inteligencia`) | 8 | 7420 | 13270 | 5 | 17400 | 5300 | 4750 | 1900 | 0 | 29350 | 7200 | 13 | 42620 |

### 4.3. Comparativa por las Doce Civilizaciones (`base.._c` vs `_d.._f` vs Total 7 Nodos)

| Civilización | Base 4 nodos (`base.._c`) Total | Nuevos 3 nodos (`_d.._f`) Oro | Madera | Piedra | Hierro | Comida | Nuevos Total | Dur. Nuevos (s) | Total 7 Nodos | Ratio Nuevos / Base |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ingleses (`ingleses`) | 5480 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 23680 | ×3.321 |
| Romanos (`romanos`) | 6610 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24810 | ×2.753 |
| Griegos (`griegos`) | 6520 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24720 | ×2.791 |
| Vikingos (`vikingos`) | 6120 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24320 | ×2.974 |
| Bizantinos (`bizantinos`) | 6600 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24800 | ×2.758 |
| Árabes (`arabes`) | 5030 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 23230 | ×3.618 |
| Mongoles (`mongoles`) | 5080 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 23280 | ×3.583 |
| Chinos (`chinos`) | 6470 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24670 | ×2.813 |
| Japoneses (`japoneses`) | 6470 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 24670 | ×2.813 |
| Navajos (`navajos`) | 5000 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 23200 | ×3.640 |
| Aztecas (`aztecas`) | 5200 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 23400 | ×3.500 |
| Masáis (`masais`) | 4350 | 9800 | 3350 | 3200 | 1850 | 0 | 18200 | 4500 | 22550 | ×4.184 |

**Origen de las diferencias entre civilizaciones:** En los niveles 2–5 (`base` y `_a.._c`), cada civilización poseía costes heterogéneos temáticos (desde `4350` recursos totales en Masáis hasta `6610` en Romanos o `6600` en Bizantinos), por lo que el salto porcentual hacia `_d` oscila entre `×1.286` (Bizantinos, desde `3500`) y `×1.957` (Masáis, desde `2300`). A partir de la ampliación (`_d` en Univ 6 = `4500`, `_e` en Univ 7 = `5950`, `_f` en Univ 8 = `7750`), las 12 civilizaciones convergen a una plantilla simétrica de **18200** recursos totales y **4500 s** acumulados en el tramo final, diferenciándose exclusivamente por la especialización de sus pares de efectos sin que ningún efecto supere `TECH_EFFECT_CAPS`.

### 4.4. Comparativa por Nivel de Universidad (Niveles 1–8 y Desglose de Niveles 6, 7 y 8)

| Nivel Univ | Nodos totales | Oro total | Madera total | Piedra total | Hierro total | Comida total | Recursos totales | Duración media (s) | Coste medio/nodo |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nivel 1 | 6 | 600 | 610 | 480 | 40 | 0 | 1730 | 40.0 | 288.3 |
| Nivel 2 | 24 | 5210 | 3610 | 3060 | 1100 | 0 | 12980 | 311.9 | 540.8 |
| Nivel 3 | 47 | 21800 | 9420 | 8840 | 5380 | 0 | 45440 | 420.0 | 966.8 |
| Nivel 4 | 25 | 17560 | 6850 | 6740 | 2670 | 0 | 33820 | 480.0 | 1352.8 |
| Nivel 5 | 33 | 50500 | 18200 | 16130 | 10850 | 0 | 95680 | 883.6 | 2899.4 |
| Nivel 6 | 20 | 50250 | 17270 | 16150 | 7940 | 0 | 91610 | 1200.0 | 4580.5 |
| Nivel 7 | 19 | 63000 | 20800 | 19880 | 10070 | 0 | 113750 | 1500.0 | 5986.8 |
| Nivel 8 | 17 | 73650 | 23500 | 22650 | 12250 | 0 | 132050 | 1800.0 | 7767.6 |

Desglose específico entre universales y exclusivas en los niveles 6, 7 y 8:

| Nivel y segmento | Nodos | Oro/nodo (rango) | Total/nodo (rango) | Recursos totales segmento | Duración base (s) | Incremento medio frente al nivel anterior |
| --- | ---: | --- | --- | ---: | ---: | --- |
| Nivel 6 — Universales | 8 | 2550–2800 | 4560–4870 | 37610 | 1200 | ×1.580 (global nivel 6 vs 5) |
| Nivel 6 — Exclusivas | 12 | 2400–2400 | 4500–4500 | 54000 | 1200 | ×1.477 sobre media Univ 5 exclusivas (3047.5) |
| Nivel 7 — Universales | 7 | 3400–3600 | 5800–6390 | 42350 | 1500 | ×1.307 (global nivel 7 vs 6) |
| Nivel 7 — Exclusivas | 12 | 3200–3200 | 5950–5950 | 71400 | 1500 | ×1.322 sobre tier anterior |
| Nivel 8 — Universales | 5 | 4500–4800 | 7600–8000 | 39050 | 1800 | ×1.297 (global nivel 8 vs 7) |
| Nivel 8 — Exclusivas | 12 | 4200–4200 | 7750–7750 | 93000 | 1800 | ×1.303 sobre tier anterior |

### 4.5. Comprobación de ausencia de desbordamiento de topes en las 12 civilizaciones

Con las **107 investigaciones universales** más las **7 exclusivas propias** de cada civilización (114 tecnologías completadas), todos los modificadores permanecen estrictamente `<= cap` (verificado en el test 27 de `convex/technologyPureTests.ts`).

---

## 5. Verificación Documental Automática

Se comprobó automáticamente mediante lectura directa de `convex/balanceConfig.ts` y análisis sintáctico de las 56 filas y 56 fichas individuales de este documento que:
- Aparecen exactamente **56 investigaciones nuevas** (**20 universales** + **36 exclusivas** = **56**, sin ausencias ni identificadores repetidos).
- Los 56 nombres, ramas, civilizaciones, niveles de Universidad, costes de oro/madera/piedra/hierro/comida, duraciones base, requisitos tecnológicos, requisitos de edificios, efectos primarios/secundarios y topes coinciden exactamente con `TECHNOLOGIES` y `TECH_EFFECT_CAPS`.
- Los totales globales (`337410` recursos totales y `83100 s` acumulados), desgloses por rama, civilización y nivel coinciden con la suma aritmética del catálogo.

---

## VALIDACIÓN TÉCNICA Y CIERRE DEFINITIVO

- **Commit exacto validado:** Sin directorio `.git` en el entorno de trabajo (`/app/applet`); validación ejecutada íntegramente sobre el estado actual del directorio tras `npm ci` (sin modificaciones funcionales de código).
- **Fecha y entorno de ejecución:** `2026-11-24` (`11:06–11:10 UTC` / `03:06–03:10 -08:00`) · `Linux 4.19.0-gvisor x86_64` · `Node.js v22.23.5` · `npm 10.9.9`.
- **Instalación limpia (`npm ci`):**
  - Comando: `npm ci`
  - Resultado: `added 142 packages, and audited 143 packages in 31s`
  - Código de salida: `0`
- **Pruebas específicas de investigaciones, motor tecnológico y dominios afectados:**
  - Comando 1 (Vitest equilibrio + investigación): `npx vitest run convex/balancing.test.ts convex/researchFixes.test.ts`
    - Resultado: **27 ejecutadas · 27 aprobadas · 0 fallidas · 0 omitidas** (`Test Files 2 passed (2)`, duración `6.17s`), código de salida `0`.
  - Comando 2 (Batería pura completa — incluye `convex/technologyPureTests.ts` pruebas 1–37, economía, militar, exploración, civilizaciones, parlamento y bots): `npm run test` (`tsx scripts/runEconomicTests.ts`)
    - Resultado: **264 ejecutadas · 264 aprobadas · 0 fallidas · 0 omitidas** (duración `784 ms`), código de salida `0`.
  - Comando 3 (Integración específica de economía, investigación, combate/asedio, espionaje, exploración, civilizaciones, Parlamento, bots y seguridad): `npx vitest run convex/balancing.test.ts convex/researchFixes.test.ts convex/civilizations.test.ts convex/parliamentDiscovery.test.ts convex/territories.test.ts convex/spySystem.test.ts convex/integration.test.ts convex/complianceFixes.test.ts convex/phase2Fixes.test.ts convex/phase3Fixes.test.ts convex/missions.test.ts convex/market.test.ts convex/conquestRewards.test.ts`
    - Resultado: **177 ejecutadas · 177 aprobadas · 0 fallidas · 0 omitidas** (`Test Files 13 passed (13)`, duración `26.89s`), código de salida `0`.
- **Suite completa de pruebas del proyecto:**
  - Suite de integración completa (`npm run test:integration` -> `vitest run`): **21 archivos · 330 pruebas ejecutadas · 330 aprobadas · 0 fallidas · 0 omitidas** (duración `72.25s`), código de salida `0`.
  - Suite pura completa (`npm run test` -> `tsx scripts/runEconomicTests.ts`): **264 pruebas ejecutadas · 264 aprobadas · 0 fallidas · 0 omitidas**, código de salida `0`.
- **TypeScript y Lint completo (`npm run lint`):**
  - Comando real configurado en `package.json`: `npm run lint` (`tsc --noEmit && tsc --noEmit -p convex`)
  - Resultado: **0 errores en cliente (`tsconfig.json`) y 0 errores en backend Convex (`convex/tsconfig.json`)**, sin exclusiones ni desactivación de reglas.
  - Código de salida: `0`
- **Build de producción (`npm run build`):**
  - Comando real configurado en `package.json`: `npm run build` (`tsc && vite build`)
  - Resultado: **1.772 módulos transformados**, artefactos generados en `dist/` (`built in 1.83s`).
  - Código de salida: `0`
- **Correcciones efectuadas durante el cierre:** Ninguna corrección funcional ni de equilibrio en el código de juego; únicamente ampliación y verificación exacta de este documento (`docs/AMPLIACION_INVESTIGACIONES_56_NUEVAS.md`).
- **Confirmación de integridad:** No se han modificado las 135 investigaciones anteriores ni las 56 nuevas, ni sus costes, duraciones, efectos, topes, fórmulas, consumidores, Universidad (máx. 3 ranuras), interfaz, mapa de 7.651 hexágonos (radio 50), base de datos, migraciones, infraestructura, hosting, variables de entorno ni recursos gráficos.
