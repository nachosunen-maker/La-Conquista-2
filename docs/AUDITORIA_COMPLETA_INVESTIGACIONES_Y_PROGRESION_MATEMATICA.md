# Auditoría Técnica y Matemática Completa del Sistema de Investigaciones — La Conquista

**Fecha de auditoría:** 2026-11-23  
**Repositorio:** `nachosunen-maker/La-Conquista-2`  
**Rama:** `main`  
**Commit auditado:** `e8ca2b625ef8024d92722f9ce09111ad082659f2`  
**Alcance:** Auditoría técnica, matemática, estructural, de seguridad y de aislamiento por civilización en modo estrictamente de solo lectura (sin modificación de código ni esquemas).

---

## 1. Resumen Ejecutivo y Archivos Inspeccionados

El sistema de investigaciones de **La Conquista** se articula sobre un catálogo plano e inmutable (`TECHNOLOGIES`) en `convex/balanceConfig.ts` con **135 tecnologías** totales:
- **87 tecnologías universales** distribuidas en **4 ramas generales**: `economica` (26), `civil` (21), `militar` (32) e `inteligencia` (8).
- **48 tecnologías exclusivas de civilización** en la rama `civilizacion` (**12 civilizaciones × 4 tecnologías cada una**: 1 nodo raíz de nivel 2, 2 nodos intermedios `_a`/`_b` de nivel 3, y 1 nodo final `_c` de nivel 5).
- Cada reino puede investigar como máximo **91 tecnologías** (87 generales + las 4 de su propia civilización).

### Métricas globales del catálogo

| Ámbito | Nº Techs | Oro | Madera | Piedra | Hierro | Comida | Total Recursos | Duración Base (s) | Duración Mín. Tech ×0,60 (s) | Duración Mín. Griegos ×0,54 (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rama `economica` | 26 | 16.700 | 7.710 | 6.920 | 2.110 | 0 | 33.440 | 11.505 s (3h 11m 45s) | 6.903 s | 6.228 s |
| Rama `civil` | 21 | 16.090 | 7.090 | 7.750 | 1.580 | 0 | 32.510 | 9.990 s (2h 46m 30s) | 5.994 s | 5.408 s |
| Rama `militar` | 32 | 22.100 | 7.540 | 6.970 | 4.890 | 0 | 41.500 | 15.390 s (4h 16m 30s) | 9.234 s | 8.329 s |
| Rama `inteligencia` | 8 | 7.420 | 2.470 | 2.540 | 840 | 0 | 13.270 | 4.380 s (1h 13m 00s) | 2.628 s | 2.371 s |
| **Subtotal Generales** | **87** | **62.310** | **24.810** | **24.180** | **9.420** | **0** | **120.720** | **41.265 s (11h 27m 45s)** | **24.759 s** | **22.336 s** |
| Rama `civilizacion` (12 civs) | 48 | 33.360 | 13.880 | 11.070 | 10.620 | 0 | 68.930 | 27.360 s (7h 36m 00s) | 16.416 s | 14.808 s |
| **Total Catálogo Global** | **135** | **95.670** | **38.690** | **35.250** | **20.040** | **0** | **189.650** | **68.625 s (19h 03m 45s)** | **41.175 s** | **37.144 s** |

*(Nota: la columna de duración bonificada mínima suma `Math.ceil(durationSeconds * multiplier)` tecnología por tecnología, coincidiendo con el cálculo que muestra `getTechnologies`.)*

### Archivos reales inspeccionados

| Archivo | Rol en el sistema |
| --- | --- |
| `convex/balanceConfig.ts` | Catálogo `TECHNOLOGIES` (135 nodos), `TECH_EFFECT_CAPS`, `RESEARCH`, `RESEARCH_SLOTS_BY_UNIVERSITY`, `RESEARCH_TIME_SCALE`, `CIVILIZATIONS`, `LEGACY_TECHNOLOGY_IDS`, `LEGACY_CIVILIZATION_IDS`, `EQUIPMENT_UNLOCKS`, `MISSIONS`, `PARLIAMENT.ESPIONAGE`. |
| `convex/technologyRules.ts` | Lógica pura: `TECHNOLOGY_CATALOG`, `normalizeTechnologyId`, `researchSlots`, `computeTechnologyModifiers`, `evaluateTechnologyStatus`, `createResearchPlan`, `researchProgress`, `calculateResearchCancellationRefund`, `readCompletedTechnologyIds`. |
| `convex/technologies.ts` | Endpoints Convex: `getTechnologies` (query), `researchTechnology`, `cancelResearch` (mutations), `completeResearch` (`internalMutation`), `completeDueResearch`. |
| `convex/civilizationRules.ts` | `normalizeCivilizationId`, `getCivilization`, `getCivilizationPassive`, `validateCivilizationTechAccess`, `getUniqueTechForCivilization`. |
| `convex/civilizations.ts` | Queries públicas `listCivilizations`, `getCivilizationMatrix`. |
| `convex/schema.ts` | Definición de tablas (`kingdoms`, `technologyProgress`) e índices (`by_kingdom`, `by_kingdom_and_technology`), flags globales `schemaValidation: false` y `strictTableNameTypes: false`. |
| `convex/buildings.ts` & `convex/buildingRules.ts` | Aplicación de `constructionDuration`, `constructionCost`, `housingCapacityBonus`. |
| `convex/economy.ts`, `convex/economyExtended.ts`, `convex/economyAdapter.ts`, `convex/economyCalculations.ts` | Liquidación económica (`settleRelationalKingdomEconomy`), proyecciones (`getKingdom`, `getSimulatedKingdomResources`), `woundedRecovery`, `foodConsumption`, `agricultureProduction`, `miningProduction`, `wood/stone/iron/goldProduction`, `storageCapacity`, `happinessBase`, `taxTolerance`, `computeMorale`. |
| `convex/army.ts`, `convex/armyRules.ts`, `convex/battleRules.ts` | Entrenamiento (`trainingDuration`), armas/armaduras (`unlockWeaponSteel`, `unlockArmorSteel`, `unlockWeaponAdvancedSteel`), mercenarios (`mercenaryCost`), marcha (`marchSpeed`, `marchFatigue`, `fatigueAccrual`), combate (`combatAttack`, `combatDefense`, `moraleBase`, `unitEfficiency*`, `woundedRate`). |
| `convex/territoryRules.ts` & `convex/territories.ts` & `convex/explorationRules.ts` | Fórmulas de marcha (`marchTimeSeconds`, `marchFatigue`), exploración (`hasSpy2Tech`). |
| `convex/parliament.ts` & `convex/bots.ts` | Espionaje/contrainteligencia (`espionageAccuracy`, `counterEspionage`), desafíos (`acceptChallenge`, `snapshotSide`). |
| `convex/missions.ts` & `convex/missionRules.ts` | Evaluación de `completedTechnologyIds`, misiones secretas de civilización y tope de almacén en recompensas. |
| `convex/compensation.ts` & `convex/kingdoms.ts` | Lectura de `technologyProgress`, proyección de capacidad y estado completo del reino (`getKingdomFull`). |
| `src/components/UniversityPanel.tsx` & `src/App.tsx` | Renderizado de ramas, ranuras, modificadores activos, bloqueo e invocación de mutaciones. |

---

## 2. Inventario Maestro Completo de Investigaciones (135 Tecnologías)

Convenciones de la tabla maestra:
- **Costes**: `Oro / Madera / Piedra / Hierro / Comida` (todas las tecnologías tienen `food = 0`).
- **Duración bonificada**: muestra `ceil(base × 0,60)` (máxima reducción por tecnologías generales/civ) y `ceil(base × 0,54)` (con pasiva griega `0,90 × 0,60`).
- **Requisitos edificio**: además de `universityLevel`, se indican entradas en `buildingRequirements` (`univ:X` indica cuándo `universidad` también aparece explícita en `buildingRequirements`).

| # | ID | Nombre | Rama | Niv. Univ | Costes (O/M/P/H/C) | Total Rec. | Dur. Base | Dur. Mín. (×0,60 / ×0,54) | Req. Edificios | Req. Techs | Civ. | Efecto (`key = value` — descripción) | Tope (`TECH_EFFECT_CAPS`) | Notas |
| ---: | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `agri_1` | Rotación de cultivos | `economica` | 1 | 100 / 100 / 50 / 0 / 0 | 250 | 30s | 18s / 17s | — | — | Todas | `agricultureProduction` = `0.05` (+5 % producción agrícola) | 0.65 (65 %) | En `×0.54`, `mutMs=16201` (IEEE-754) vs `17s` |
| 2 | `agri_2` | Arado de vertedera de hierro | `economica` | 2 | 200 / 150 / 100 / 50 / 0 | 500 | 180s | 108s / 98s | granja:2 | agri_1 | Todas | `agricultureProduction` = `0.08` (+8 % producción agrícola por labranza profunda) | 0.65 (65 %) | — |
| 3 | `agri_3` | Acequias y molinos hidráulicos | `economica` | 3 | 400 / 250 / 200 / 80 / 0 | 930 | 360s | 216s / 195s | granja:4, cantera:2 | agri_2 | Todas | `agricultureProduction` = `0.12` (+12 % rendimiento en molienda y riego) | 0.65 (65 %) | — |
| 4 | `agri_4` | Barbecho trienal y abonado | `economica` | 4 | 650 / 390 / 240 / 50 / 0 | 1330 | 480s | 288s / 260s | castillo:4, universidad:4 | agri_3 | Todas | `agricultureProduction` = `0.06` (+6 % producción agrícola) | 0.65 (65 %) | `universidad` explícita |
| 5 | `agri_5` | Molinos de viento y hornos comunales | `economica` | 4 | 650 / 390 / 240 / 50 / 0 | 1330 | 480s | 288s / 260s | castillo:4, universidad:4 | agri_3 | Todas | `foodConsumption` = `-0.04` (Consumo de alimentos −4 %) | 0.15 (-15 %) | `universidad` explícita |
| 6 | `agri_6` | Pósitos y graneros comunales | `economica` | 4 | 650 / 390 / 240 / 50 / 0 | 1330 | 480s | 288s / 260s | castillo:4, universidad:4 | agri_3, storage_1 | Todas | `storageCapacity` = `0.08` (+8 % capacidad de almacenamiento) | 1.00 (100 %) | `universidad` explícita |
| 7 | `agri_7` | Rotación de cuatro hojas | `economica` | 5 | 1100 / 500 / 360 / 90 / 0 | 2050 | 720s | 432s / 389s | castillo:6, universidad:5 | agri_4, agri_5 | Todas | `agricultureProduction` = `0.08` (+8 % producción agrícola) | 0.65 (65 %) | `universidad` explícita |
| 8 | `agri_8` | Tratado de agronomía | `economica` | 5 | 1800 / 1040 / 560 / 150 / 0 | 3550 | 1080s | 648s / 584s | castillo:8, universidad:5 | agri_7, agri_6 | Todas | `agricultureProduction` = `0.1` (+10 % producción agrícola) | 0.65 (65 %) | `universidad` explícita |
| 9 | `mining_1` | Herramientas mineras de hierro | `economica` | 1 | 100 / 80 / 80 / 10 / 0 | 270 | 30s | 18s / 17s | — | — | Todas | `miningProduction` = `0.05` (+5 % madera, piedra y hierro) | 0.50 (50 %) | — |
| 10 | `mining_2` | Lavaderos de mineral y desmonte | `economica` | 2 | 250 / 150 / 150 / 60 / 0 | 610 | 240s | 144s / 130s | minaHierro:2 | mining_1 | Todas | `miningProduction` = `0.08` (+8 % extracción de materiales y mineral) | 0.50 (50 %) | — |
| 11 | `mining_3` | Entibado de galerías | `economica` | 3 | 400 / 180 / 240 / 60 / 0 | 880 | 360s | 216s / 195s | castillo:3, universidad:3, minaHierro:3 | mining_2 | Todas | `miningProduction` = `0.05` (+5 % madera, piedra y hierro) | 0.50 (50 %) | `universidad` explícita |
| 12 | `mining_4` | Aserraderos de sierra hidráulica | `economica` | 3 | 400 / 180 / 240 / 60 / 0 | 880 | 360s | 216s / 195s | castillo:5, universidad:3, aserradero:5 | mining_1 | Todas | `woodProduction` = `0.1` (+10 % producción de madera) | 0.30 (30 %) | `universidad` explícita |
| 13 | `mining_5` | Canteras de cuña y talla | `economica` | 3 | 400 / 180 / 240 / 60 / 0 | 880 | 360s | 216s / 195s | castillo:5, universidad:3, cantera:5 | mining_1 | Todas | `stoneProduction` = `0.1` (+10 % producción de piedra) | 0.30 (30 %) | `universidad` explícita |
| 14 | `mining_6` | Altos hornos de fundición | `economica` | 4 | 650 / 270 / 360 / 100 / 0 | 1380 | 480s | 288s / 260s | castillo:5, universidad:4, minaHierro:5, herreria:3 | mining_2 | Todas | `ironProduction` = `0.1` (+10 % producción de hierro) | 0.30 (30 %) | `universidad` explícita |
| 15 | `mining_7` | Filones de oro y lavado aurífero | `economica` | 4 | 650 / 270 / 360 / 100 / 0 | 1380 | 480s | 288s / 260s | castillo:4, universidad:4, minaOro:4 | mining_3 | Todas | `goldProduction` = `0.06` (+6 % producción total de oro) | 0.60 (60 %) | `universidad` explícita |
| 16 | `mining_8` | Gremios de mineros y canteros | `economica` | 5 | 1100 / 450 / 540 / 180 / 0 | 2270 | 720s | 432s / 389s | castillo:6, universidad:5 | mining_4, mining_5, mining_6 | Todas | `miningProduction` = `0.08` (+8 % extracción de madera, piedra y hierro) | 0.50 (50 %) | `universidad` explícita |
| 17 | `mining_9` | Cecas y orfebrería real | `economica` | 5 | 1100 / 450 / 540 / 180 / 0 | 2270 | 720s | 432s / 389s | castillo:6, universidad:5, minaOro:6 | mining_7, trade_2 | Todas | `goldProduction` = `0.06` (+6 % producción total de oro) | 0.60 (60 %) | `universidad` explícita |
| 18 | `storage_1` | Almacenes reforzados | `economica` | 1 | 100 / 150 / 100 / 0 / 0 | 350 | 45s | 27s / 25s | — | — | Todas | `storageCapacity` = `0.1` (+10 % capacidad de almacenamiento) | 1.00 (100 %) | — |
| 19 | `storage_2` | Silos y bodegas subterráneas | `economica` | 3 | 400 / 180 / 240 / 60 / 0 | 880 | 360s | 216s / 195s | castillo:3, universidad:3 | storage_1 | Todas | `storageCapacity` = `0.1` (+10 % capacidad de almacenamiento) | 1.00 (100 %) | `universidad` explícita |
| 20 | `storage_3` | Reservas de guerra | `economica` | 5 | 1100 / 450 / 540 / 180 / 0 | 2270 | 720s | 432s / 389s | castillo:6, universidad:5 | storage_2, trade_1 | Todas | `storageCapacity` = `0.12` (+12 % capacidad de almacenamiento) | 1.00 (100 %) | `universidad` explícita |
| 21 | `trade_1` | Estándar real de pesos y medidas | `economica` | 2 | 200 / 150 / 150 / 20 / 0 | 520 | 180s | 108s / 98s | mercado:1 | storage_1 | Todas | `storageCapacity` = `0.15` (+15 % capacidad de gestión comercial y logística) | 1.00 (100 %) | — |
| 22 | `trade_2` | Ferias y caravanas regulares | `economica` | 3 | 520 / 160 / 160 / 40 / 0 | 880 | 360s | 216s / 195s | castillo:3, universidad:3, mercado:3 | trade_1 | Todas | `goldProduction` = `0.06` (+6 % producción total de oro) | 0.60 (60 %) | `universidad` explícita |
| 23 | `trade_3` | Lonjas y letras de cambio | `economica` | 4 | 850 / 240 / 240 / 70 / 0 | 1400 | 480s | 288s / 260s | castillo:5, universidad:4, mercado:5 | trade_2 | Todas | `goldProduction` = `0.08` (+8 % producción total de oro) | 0.60 (60 %) | `universidad` explícita |
| 24 | `trade_4` | Banca de los gremios | `economica` | 5 | 1430 / 400 / 360 / 110 / 0 | 2300 | 720s | 432s / 389s | castillo:6, universidad:5, mercado:5 | trade_3, mining_7 | Todas | `goldProduction` = `0.1` (+10 % producción total de oro) | 0.60 (60 %) | `universidad` explícita |
| 25 | `construction_1` | Cantería de sillería | `civil` | 1 | 100 / 100 / 150 / 10 / 0 | 360 | 45s | 27s / 25s | — | — | Todas | `constructionDuration` = `-0.05` (−5 % duración de construcción) | 0.60 floor (-40 %) | — |
| 26 | `construction_2` | Grúas de rueda de ardilla | `civil` | 2 | 250 / 200 / 200 / 30 / 0 | 680 | 240s | 144s / 130s | castillo:2, universidad:2 | construction_1 | Todas | `constructionDuration` = `-0.08` (−8 % duración en izado de cargas pesadas) | 0.60 floor (-40 %) | `universidad` explícita |
| 27 | `construction_3` | Andamios y maestros de obra | `civil` | 3 | 400 / 220 / 260 / 40 / 0 | 920 | 360s | 216s / 195s | castillo:3, universidad:3 | construction_2 | Todas | `constructionDuration` = `-0.06` (−6 % duración de construcción) | 0.60 floor (-40 %) | `universidad` explícita |
| 28 | `construction_4` | Arbotantes y contrafuertes | `civil` | 3 | 500 / 260 / 320 / 50 / 0 | 1130 | 360s | 216s / 195s | castillo:4, universidad:3, cantera:5 | construction_3 | Todas | `constructionCost` = `-0.06` (−6 % coste de construcción de edificios) | 0.25 (-25 %, floor 0.75) | `universidad` explícita |
| 29 | `construction_5` | Encofrados y mortero hidráulico | `civil` | 4 | 800 / 350 / 450 / 80 / 0 | 1680 | 480s | 288s / 260s | castillo:5, universidad:4 | construction_4 | Todas | `constructionCost` = `-0.07` (−7 % coste de construcción de edificios) | 0.25 (-25 %, floor 0.75) | `universidad` explícita |
| 30 | `construction_6` | Maestros de cantería y gremios | `civil` | 4 | 950 / 400 / 520 / 90 / 0 | 1960 | 480s | 288s / 260s | castillo:5, universidad:4, cantera:6 | construction_5 | Todas | `constructionCost` = `-0.06` (−6 % coste de construcción de edificios) | 0.25 (-25 %, floor 0.75) | `universidad` explícita |
| 31 | `construction_7` | Arquitectura monumental de fábrica | `civil` | 5 | 1500 / 650 / 800 / 150 / 0 | 3100 | 720s | 432s / 389s | castillo:7, universidad:5 | construction_6 | Todas | `constructionCost` = `-0.06` (−6 % coste de construcción de edificios) | 0.25 (-25 %, floor 0.75) | `universidad` explícita |
| 32 | `construction_8` | Obra maestra del reino | `civil` | 5 | 1800 / 880 / 910 / 190 / 0 | 3780 | 1080s | 648s / 584s | castillo:8, universidad:5 | construction_6, construction_7 | Todas | `constructionCost` = `-0.06` (−6 % coste de construcción de edificios) | 0.25 (-25 %, floor 0.75) | Excede tope `0.25` (−0.31 acumulado, 6 pp perdidos) |
| 33 | `educ_1` | Tratados escolásticos y trivium | `civil` | 2 | 200 / 120 / 100 / 20 / 0 | 440 | 180s | 108s / 98s | castillo:2, universidad:2 | — | Todas | `researchDuration` = `-0.08` (−8 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | `universidad` explícita |
| 34 | `educ_2` | Quadrivium y cátedras reales | `civil` | 3 | 450 / 200 / 180 / 40 / 0 | 870 | 360s | 216s / 195s | castillo:3, universidad:3 | educ_1 | Todas | `researchDuration` = `-0.1` (−10 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | `universidad` explícita |
| 35 | `educ_3` | Bibliotecas monacales y cartularios | `civil` | 4 | 750 / 300 / 280 / 70 / 0 | 1400 | 480s | 288s / 260s | castillo:4, universidad:4 | educ_2 | Todas | `researchDuration` = `-0.12` (−12 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | `universidad` explícita |
| 36 | `educ_4` | Academia de ciencias reales | `civil` | 5 | 1250 / 500 / 480 / 120 / 0 | 2350 | 720s | 432s / 389s | castillo:6, universidad:5 | educ_3 | Todas | `researchDuration` = `-0.1` (−10 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | Satura el tope `0.40` (−0.40 exacto) |
| 37 | `educ_5` | Ingeniería y mecánica | `civil` | 4 | 850 / 240 / 300 / 80 / 0 | 1470 | 480s | 288s / 260s | castillo:4, universidad:4 | educ_2, construction_3 | Todas | `constructionDuration` = `-0.05` (−5 % duración de construcción) | 0.60 floor (-40 %) | `universidad` explícita |
| 38 | `educ_6` | Sabios y consejeros del reino | `civil` | 5 | 2340 / 640 / 700 / 230 / 0 | 3910 | 1080s | 648s / 584s | castillo:8, universidad:5 | educ_3, educ_5 | Todas | `researchDuration` = `-0.08` (−8 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | Con `educ_1..4` supera tope `0.40` (−0.48) |
| 39 | `happiness_1` | Fiestas y ferias comunales | `civil` | 1 | 100 / 100 / 50 / 0 / 0 | 250 | 45s | 27s / 25s | — | — | Todas | `happinessBase` = `3` (+3 felicidad base) | 30 pts | — |
| 40 | `happiness_2` | Fueros de villa y gremios | `civil` | 3 | 350 / 150 / 150 / 20 / 0 | 670 | 360s | 216s / 195s | castillo:3, mercado:2 | happiness_1 | Todas | `happinessBase` = `5` (+5 felicidad base por autogobierno gremial) | 30 pts | — |
| 41 | `happiness_4` | Justas, circo y festejos | `civil` | 3 | 400 / 220 / 260 / 40 / 0 | 920 | 360s | 216s / 195s | castillo:3, universidad:3, circo:3 | happiness_1 | Todas | `happinessBase` = `3` (+3 felicidad base) | 30 pts | `universidad` explícita |
| 42 | `happiness_5` | Exención de cargas y patronato | `civil` | 3 | 400 / 180 / 180 / 40 / 0 | 800 | 360s | 216s / 195s | castillo:3, universidad:3, mercado:2 | happiness_1 | Todas | `taxTolerance` = `-0.5` (−50 % penalización por impuestos altos) | 0.50 (-50 %) | Satura en un único nodo el tope `0.50` |
| 43 | `training_1` | Doctrina de instrucción de levas | `militar` | 1 | 100 / 80 / 50 / 20 / 0 | 250 | 45s | 27s / 25s | cuartel:1 | — | Todas | `trainingDuration` = `-0.05` (−5 % duración de entrenamiento militar) | 0.60 floor (-40 %) | — |
| 44 | `training_2` | Ordenanzas de regimiento | `militar` | 3 | 300 / 150 / 100 / 80 / 0 | 630 | 300s | 180s / 162s | cuartel:3, universidad:3 | training_1 | Todas | `trainingDuration` = `-0.1` (−10 % duración de adiestramiento en filas) | 0.60 floor (-40 %) | `universidad` explícita |
| 45 | `training_3` | Campos de instrucción permanentes | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:5, universidad:4, cuartel:5 | training_2 | Todas | `trainingDuration` = `-0.06` (−6 % duración de entrenamiento militar) | 0.60 floor (-40 %) | `universidad` explícita |
| 46 | `medicine_1` | Cataplasmas y huertos medicinales | `militar` | 2 | 100 / 80 / 80 / 10 / 0 | 270 | 45s | 27s / 25s | castillo:2, universidad:2 | — | Todas | `woundedRecovery` = `0.05` (+5 pp de recuperación de heridos) | 0.60 (60 pp) | `universidad` explícita |
| 47 | `medical_2` | Cirugía de campaña y triaje | `militar` | 3 | 400 / 150 / 200 / 100 / 0 | 850 | 360s | 216s / 195s | hospitalMilitar:2, universidad:3 | medicine_1 | Todas | `woundedRecovery` = `0.1` (+10 pp recuperación de heridos en hospital) | 0.60 (60 pp) | Sin `castillo` explícito (implícito por `univ:3`) |
| 48 | `medicine_3` | Herboristería y boticas | `militar` | 3 | 400 / 160 / 200 / 50 / 0 | 810 | 360s | 216s / 195s | castillo:3, universidad:3, hospitalMilitar:2 | medicine_1 | Todas | `happinessBase` = `2` (+2 felicidad base) | 30 pts | `universidad` explícita |
| 49 | `weapons_1` | Metalurgia del acero | `militar` | 3 | 300 / 100 / 150 / 100 / 0 | 650 | 300s | 180s / 162s | castillo:3, universidad:3, herreria:3 | — | Todas | `unlockWeaponSteel` = `1` (Desbloquea arma de acero (×1,15)) | Desbloqueo (`acero`) | Equipar exige `herreria:4` (`EQUIPMENT_UNLOCKS`) |
| 50 | `armor_1` | Armaduras de hierro y malla | `militar` | 3 | 300 / 100 / 150 / 100 / 0 | 650 | 300s | 180s / 162s | castillo:3, universidad:3, herreria:3 | — | Todas | `unlockArmorSteel` = `1` (Desbloquea armadura de acero (×1,25)) | Desbloqueo (`acero`) | Equipar exige `herreria:4` (`EQUIPMENT_UNLOCKS`) |
| 51 | `advanced_steel` | Acero al crisol y caldeado | `militar` | 3 | 600 / 200 / 250 / 200 / 0 | 1250 | 480s | 288s / 260s | castillo:5, universidad:3, herreria:4 | weapons_1 | Todas | `unlockWeaponAdvancedSteel` = `1` (Desbloquea arma de acero avanzado (×1,30)) | Desbloqueo (`aceroAvanzado`) | `universidad` explícita |
| 52 | `forge_2` | Templado y revenido | `militar` | 4 | 780 / 150 / 240 / 260 / 0 | 1430 | 480s | 288s / 260s | castillo:4, universidad:4, herreria:4 | weapons_1 | Todas | `combatAttack` = `0.03` (+3 % ataque militar) | 0.25 (25 %) | `universidad` explícita |
| 53 | `forge_3` | Cotas de malla y escudos reforzados | `militar` | 4 | 780 / 150 / 240 / 260 / 0 | 1430 | 480s | 288s / 260s | castillo:4, universidad:4, herreria:4 | armor_1 | Todas | `combatDefense` = `0.03` (+3 % defensa militar) | 0.25 (25 %) | `universidad` explícita |
| 54 | `forge_4` | Aceros de crisol refinado | `militar` | 5 | 1320 / 250 / 360 / 440 / 0 | 2370 | 720s | 432s / 389s | castillo:6, universidad:5, herreria:5 | advanced_steel, forge_2 | Todas | `combatAttack` = `0.03` (+3 % ataque militar) | 0.25 (25 %) | `universidad` explícita |
| 55 | `forge_5` | Armaduras de placas articuladas | `militar` | 5 | 1320 / 250 / 360 / 440 / 0 | 2370 | 720s | 432s / 389s | castillo:6, universidad:5, herreria:5 | forge_3, advanced_steel | Todas | `combatDefense` = `0.04` (+4 % defensa militar) | 0.25 (25 %) | `universidad` explícita |
| 56 | `logistics_1` | Intendencia y trenes de bagaje | `militar` | 3 | 400 / 160 / 120 / 80 / 0 | 760 | 360s | 216s / 195s | castillo:3, universidad:3, cuartel:3 | training_1 | Todas | `marchFatigue` = `-0.1` (−10 % fatiga de marcha) | 0.50 (50 %) | `universidad` explícita |
| 57 | `logistics_2` | Calzadas y postas militares | `militar` | 3 | 400 / 160 / 120 / 80 / 0 | 760 | 360s | 216s / 195s | castillo:3, universidad:3 | training_1 | Todas | `marchSpeed` = `0.07` (+7 % velocidad de marcha) | 0.55 (55 %) | Omitido en `army.ts:launchAttack` |
| 58 | `espionage_1` | Red de confidentes I | `inteligencia` | 2 | 200 / 100 / 100 / 20 / 0 | 420 | 180s | 108s / 98s | castillo:2, universidad:2 | — | Todas | `espionageAccuracy` = `1` (Informe militar aproximado (±15 %)) | 4 (nivel máx) | `universidad` explícita |
| 59 | `espionage_2` | Criptografía y agentes II | `inteligencia` | 4 | 500 / 200 / 200 / 100 / 0 | 1000 | 480s | 288s / 260s | universidad:4 | espionage_1 | Todas | `espionageAccuracy` = `2` (Informe militar preciso (±7 %)) | 4 (nivel máx) | Sin `castillo` explícito (implícito por `univ:4`) |
| 60 | `espionage_3` | Informantes en la corte III | `inteligencia` | 4 | 800 / 320 / 300 / 90 / 0 | 1510 | 480s | 288s / 260s | castillo:5 | espionage_2, spy_2 | Todas | `espionageAccuracy` = `3` (Informe militar detallado (±3 %)) | 4 (nivel máx) | `bots.ts` ignora nivel >= 3 |
| 61 | `espionage_4` | Maestros del espionaje IV | `inteligencia` | 5 | 2340 / 640 / 700 / 230 / 0 | 3910 | 1080s | 648s / 584s | castillo:8 | espionage_3, spy_3 | Todas | `espionageAccuracy` = `4` (Informe militar exacto) | 4 (nivel máx) | `bots.ts` ignora nivel >= 3 |
| 62 | `spy_1` | Ojos y oídos en el reino | `inteligencia` | 2 | 250 / 150 / 100 / 40 / 0 | 540 | 240s | 144s / 130s | castillo:2 | — | Todas | `counterEspionage` = `0.1` (+10 % probabilidad de contrainteligencia) | 0.60 (60 %) | — |
| 63 | `spy_2` | Exploradores y atalayas | `inteligencia` | 3 | 480 / 160 / 160 / 60 / 0 | 860 | 360s | 216s / 195s | castillo:3, universidad:3 | espionage_1 | Todas | `marchSpeed` = `0.05` (+5 % velocidad de marcha y +10 % velocidad en expediciones de exploración) | 0.55 (55 %) | +10 % exploración hardcoded por ID en `territories.ts`; `marchSpeed` omitido en `launchAttack` |
| 64 | `spy_3` | Guardia del silencio | `inteligencia` | 4 | 750 / 300 / 280 / 80 / 0 | 1410 | 480s | 288s / 260s | castillo:4 | spy_1, spy_2 | Todas | `counterEspionage` = `0.12` (+12 % probabilidad de contrainteligencia) | 0.60 (60 %) | — |
| 65 | `spy_4` | Sombras del trono | `inteligencia` | 5 | 2100 / 600 / 700 / 220 / 0 | 3620 | 1080s | 648s / 584s | castillo:8 | spy_3, espionage_3 | Todas | `counterEspionage` = `0.15` (+15 % probabilidad de contrainteligencia) | 0.60 (60 %) | — |
| 66 | `tech_civ_ingleses` | Arco largo inglés | `civilizacion` | 2 | 200 / 250 / 80 / 50 / 0 | 580 | 420s | 252s / 227s | cuartel:2, universidad:2 | — | `ingleses` | `combatAttack` = `0.05` (+5 % ataque militar (alcance letal de arquería)) | 0.25 (25 %) | Desbloquea misión secreta `sec_ingleses` |
| 67 | `tech_civ_romanos` | Legión y testudo | `civilizacion` | 2 | 200 / 80 / 250 / 80 / 0 | 610 | 420s | 252s / 227s | castillo:2, universidad:2 | — | `romanos` | `combatDefense` = `0.05` (+5 % defensa militar en formación cerrada) | 0.25 (25 %) | Desbloquea misión secreta `sec_romanos` |
| 68 | `tech_civ_griegos` | Falange y dialéctica | `civilizacion` | 2 | 250 / 100 / 150 / 60 / 0 | 560 | 420s | 252s / 227s | universidad:2 | — | `griegos` | `combatDefense` = `0.05` (+5 % defensa militar en formación de falange) | 0.25 (25 %) | Desbloquea misión secreta `sec_griegos` |
| 69 | `tech_civ_vikingos` | Drakkar y furia nórdica | `civilizacion` | 2 | 180 / 300 / 80 / 60 / 0 | 620 | 420s | 252s / 227s | cuartel:2, universidad:2 | — | `vikingos` | `combatAttack` = `0.05` (+5 % ataque militar e ímpetu de asalto) | 0.25 (25 %) | Desbloquea misión secreta `sec_vikingos` |
| 70 | `tech_civ_bizantinos` | Fuego griego y baluartes | `civilizacion` | 2 | 300 / 100 / 200 / 100 / 0 | 700 | 420s | 252s / 227s | castillo:2, universidad:2 | — | `bizantinos` | `combatDefense` = `0.06` (+6 % defensa militar y fuego defensivo) | 0.25 (25 %) | Desbloquea misión secreta `sec_bizantinos` |
| 71 | `tech_civ_arabes` | Medicina de Córdoba y riego | `civilizacion` | 2 | 250 / 120 / 120 / 40 / 0 | 530 | 420s | 252s / 227s | hospitalMilitar:1, universidad:2 | — | `arabes` | `woundedRecovery` = `0.1` (+10 pp recuperación de heridos y acequias de regadío) | 0.60 (60 pp) | Desbloquea misión secreta `sec_arabes` |
| 72 | `tech_civ_mongoles` | Tácticas de la estepa | `civilizacion` | 2 | 200 / 150 / 80 / 50 / 0 | 480 | 420s | 252s / 227s | cuartel:2, universidad:2 | — | `mongoles` | `marchSpeed` = `0.15` (+15 % velocidad de marcha y maniobra envolvente) | 0.55 (55 %) | Omitido en `launchAttack`; desbloquea `sec_mongoles` |
| 73 | `tech_civ_chinos` | Gran Muralla y pólvora | `civilizacion` | 2 | 220 / 150 / 300 / 50 / 0 | 720 | 420s | 252s / 227s | castillo:2, universidad:2 | — | `chinos` | `combatDefense` = `0.06` (+6 % defensa militar y arquitectura defensiva) | 0.25 (25 %) | Desbloquea misión secreta `sec_chinos` |
| 74 | `tech_civ_japoneses` | Acero Tamahagane y Bushido | `civilizacion` | 2 | 250 / 100 / 100 / 120 / 0 | 570 | 420s | 252s / 227s | herreria:2, universidad:2 | — | `japoneses` | `combatAttack` = `0.05` (+5 % ataque militar por temple de hojas de acero) | 0.25 (25 %) | Desbloquea misión secreta `sec_japoneses` |
| 75 | `tech_civ_navajos` | Rastreadores del bosque | `civilizacion` | 2 | 150 / 250 / 100 / 30 / 0 | 530 | 420s | 252s / 227s | universidad:2 | — | `navajos` | `marchFatigue` = `0.2` (−20 % fatiga de marcha por sendas y bosques) | 0.50 (50 %) | Signo positivo (`+0.20`); ID legacy `tech_civ_indiosAmericanos` |
| 76 | `tech_civ_aztecas` | Chinampas y sacerdotes guerreros | `civilizacion` | 2 | 200 / 200 / 150 / 30 / 0 | 580 | 420s | 252s / 227s | universidad:2 | — | `aztecas` | `agricultureProduction` = `0.08` (+8 % producción agrícola en huertos intensivos) | 0.65 (65 %) | Desbloquea misión secreta `sec_aztecas` |
| 77 | `tech_civ_masais` | Resistencia masái y sabana | `civilizacion` | 2 | 160 / 180 / 100 / 40 / 0 | 480 | 420s | 252s / 227s | universidad:2 | — | `masais` | `marchFatigue` = `0.25` (−25 % fatiga en expediciones de larga distancia) | 0.50 (50 %) | Signo positivo (`+0.25`); ID legacy `tech_civ_keniatas` |
| 78 | `happiness_3` | Capellanes de campaña y misas de leva | `civil` | 2 | 250 / 170 / 160 / 20 / 0 | 600 | 240s | 144s / 130s | castillo:2, iglesia:2 | happiness_1 | Todas | `moraleBase` = `3` (Moral militar +3 puntos) | 15 pts | Solo aplica en combate, no en `kingdom.militaryMorale` |
| 79 | `happiness_6` | Cofradías y fiestas patronales | `civil` | 4 | 650 / 330 / 390 / 70 / 0 | 1440 | 480s | 288s / 260s | castillo:4, iglesia:4, circo:4 | happiness_3, happiness_4 | Todas | `happinessBase` = `4` (+4 felicidad base) | 30 pts | — |
| 80 | `happiness_7` | Edad de oro del reino | `civil` | 5 | 1800 / 880 / 910 / 190 / 0 | 3780 | 1080s | 648s / 584s | castillo:8 | happiness_2, happiness_5, happiness_6 | Todas | `happinessBase` = `5` (+5 felicidad base) | 30 pts | — |
| 81 | `training_4` | Disciplina y ordenanza de hierro | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | training_2 | Todas | `moraleBase` = `3` (Moral militar +3 puntos) | 15 pts | Solo aplica en combate |
| 82 | `training_5` | Academia militar | `militar` | 5 | 1100 / 400 / 270 / 220 / 0 | 1990 | 720s | 432s / 389s | castillo:6, cuartel:6 | training_3, training_4 | Todas | `trainingDuration` = `-0.08` (−8 % duración de entrenamiento militar) | 0.60 floor (-40 %) | — |
| 83 | `logistics_4` | Estandartes, trompetas y banderas | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | training_4, logistics_1 | Todas | `moraleBase` = `3` (Moral militar +3 puntos) | 15 pts | Solo aplica en combate |
| 84 | `tactics_inf_1` | Escuadras de lanceros y piqueros | `militar` | 2 | 250 / 120 / 70 / 40 / 0 | 480 | 240s | 144s / 130s | castillo:2, cuartel:2 | training_1 | Todas | `unitEfficiencyInf` = `0.04` (Eficacia de infantería +4 %) | 0.30 (30 %) | — |
| 85 | `tactics_arc_1` | Compañías de arqueros y ballesteros | `militar` | 2 | 250 / 120 / 70 / 40 / 0 | 480 | 240s | 144s / 130s | castillo:2, cuartel:2 | training_1 | Todas | `unitEfficiencyArc` = `0.04` (Eficacia de arqueros +4 %) | 0.30 (30 %) | — |
| 86 | `tactics_cav_1` | Monta y caballería pesada | `militar` | 2 | 250 / 120 / 70 / 40 / 0 | 480 | 240s | 144s / 130s | castillo:2, cuartel:2 | training_1 | Todas | `unitEfficiencyCav` = `0.04` (Eficacia de caballería +4 %) | 0.30 (30 %) | — |
| 87 | `tactics_inf_2` | Infantería de línea | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | tactics_inf_1, training_2 | Todas | `unitEfficiencyInf` = `0.05` (Eficacia de infantería +5 %) | 0.30 (30 %) | — |
| 88 | `tactics_arc_2` | Salvas y tiro en masa | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | tactics_arc_1, training_2 | Todas | `unitEfficiencyArc` = `0.05` (Eficacia de arqueros +5 %) | 0.30 (30 %) | — |
| 89 | `tactics_cav_2` | Cargas de choque y maniobra | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | tactics_cav_1, training_2 | Todas | `unitEfficiencyCav` = `0.05` (Eficacia de caballería +5 %) | 0.30 (30 %) | — |
| 90 | `tactics_all` | Ejércitos de armas combinadas | `militar` | 5 | 1800 / 640 / 420 / 380 / 0 | 3240 | 1080s | 648s / 584s | castillo:8, cuartel:7 | tactics_inf_2, tactics_arc_2, tactics_cav_2 | Todas | `unitEfficiencyAll` = `0.04` (Eficacia de las tres armas +4 %) | 0.30 (30 % c/u) | — |
| 91 | `merc_1` | Contratas y capitanes de compañía | `economica` | 3 | 400 / 160 / 120 / 80 / 0 | 760 | 360s | 216s / 195s | castillo:3, universidad:3, taberna:3 | training_1 | Todas | `mercenaryCost` = `-0.08` (−8 % coste de mercenarios) | 0.30 (-30 %) | Prerrequisito cruzado con rama `militar` |
| 92 | `merc_2` | Compañías libres | `economica` | 5 | 1100 / 400 / 270 / 220 / 0 | 1990 | 720s | 432s / 389s | castillo:6, universidad:5, taberna:5 | merc_1, trade_2 | Todas | `mercenaryCost` = `-0.1` (−10 % coste de mercenarios) | 0.30 (-30 %) | `universidad` explícita |
| 93 | `medicine_2` | Ambulancias de carro y hospicio de campaña | `militar` | 3 | 400 / 160 / 200 / 50 / 0 | 810 | 360s | 216s / 195s | castillo:3, hospitalMilitar:3 | medicine_1 | Todas | `woundedRate` = `0.04` (Bajas que pasan a heridos +4 %) | 0.20 (+20 pp) | Nota: existe `medical_2` (#47) y `medicine_2` (#93) |
| 94 | `medical_3` | Cirugía de guerra y vino antiséptico | `militar` | 4 | 650 / 240 / 300 / 80 / 0 | 1270 | 480s | 288s / 260s | castillo:4, hospitalMilitar:4 | medical_2, medicine_2 | Todas | `woundedRate` = `0.05` (Bajas que pasan a heridos +5 %) | 0.20 (+20 pp) | — |
| 95 | `medical_4` | Letrinas, baños y aseo de campamento | `militar` | 4 | 650 / 240 / 300 / 80 / 0 | 1270 | 480s | 288s / 260s | castillo:4, hospitalMilitar:3 | medicine_3 | Todas | `fatigueAccrual` = `-0.05` (Fatiga acumulada −5 %) | 0.30 (-30 %) | Omitido en `parliament.ts:snapshotSide` |
| 96 | `medical_5` | Orden de caballeros hospitalarios | `militar` | 5 | 1800 / 640 / 700 / 230 / 0 | 3370 | 1080s | 648s / 584s | castillo:8, hospitalMilitar:5 | medical_3, medical_4 | Todas | `woundedRate` = `0.06` (Bajas que pasan a heridos +6 %) | 0.20 (+20 pp) | — |
| 97 | `logistics_3` | Campamentos fortificados | `militar` | 4 | 650 / 240 / 180 / 130 / 0 | 1200 | 480s | 288s / 260s | castillo:4, cuartel:4 | logistics_1 | Todas | `fatigueAccrual` = `-0.06` (Fatiga acumulada −6 %) | 0.30 (-30 %) | Omitido en `parliament.ts:snapshotSide` |
| 98 | `logistics_5` | Marchas forzadas | `militar` | 5 | 1100 / 400 / 270 / 220 / 0 | 1990 | 720s | 432s / 389s | castillo:6, cuartel:6 | logistics_2, logistics_3 | Todas | `marchSpeed` = `0.08` (+8 % velocidad de marcha) | 0.55 (55 %) | Omitido en `army.ts:launchAttack` |
| 99 | `logistics_6` | Estado mayor logístico | `militar` | 5 | 1800 / 640 / 420 / 380 / 0 | 3240 | 1080s | 648s / 584s | castillo:8 | logistics_4, logistics_5 | Todas | `marchFatigue` = `-0.1` (−10 % fatiga de marcha) | 0.50 (50 %) | — |
| 100 | `tech_civ_ingleses_a` | Arqueros de tiro largo | `civilizacion` | 3 | 600 / 500 / 0 / 200 / 0 | 1300 | 480s | 288s / — | castillo:3 | tech_civ_ingleses | `ingleses` | `unitEfficiencyArc` = `0.08` (Eficacia de arqueros +8 %) | 0.30 (30 %) | — |
| 101 | `tech_civ_ingleses_b` | Rotación de cultivos avanzada | `civilizacion` | 3 | 500 / 200 / 200 / 0 / 0 | 900 | 480s | 288s / — | castillo:3 | tech_civ_ingleses | `ingleses` | `agricultureProduction` = `0.1` (+10 % producción agrícola) | 0.65 (65 %) | — |
| 102 | `tech_civ_ingleses_c` | Dominio del Canal | `civilizacion` | 5 | 1200 / 800 / 400 / 300 / 0 | 2700 | 900s | 540s / — | castillo:6 | tech_civ_ingleses_a, tech_civ_ingleses_b | `ingleses` | `combatAttack` = `0.12` (+12 % ataque militar total) | 0.25 (25 %) | — |
| 103 | `tech_civ_romanos_a` | Formación de Testudo | `civilizacion` | 3 | 400 / 200 / 400 / 400 / 0 | 1400 | 480s | 288s / — | castillo:3 | tech_civ_romanos | `romanos` | `unitEfficiencyInf` = `0.08` (Eficacia de infantería +8 %) | 0.30 (30 %) | — |
| 104 | `tech_civ_romanos_b` | Acueductos y calzadas | `civilizacion` | 3 | 400 / 0 / 800 / 200 / 0 | 1400 | 480s | 288s / — | castillo:3 | tech_civ_romanos | `romanos` | `constructionDuration` = `-0.06` (−6 % duración de construcción) | 0.60 floor (-40 %) | — |
| 105 | `tech_civ_romanos_c` | Legado de la Legión | `civilizacion` | 5 | 1500 / 300 / 600 / 800 / 0 | 3200 | 900s | 540s / — | castillo:6 | tech_civ_romanos_a, tech_civ_romanos_b | `romanos` | `unitEfficiencyInf` = `0.09` (Eficacia de infantería +9 %) | 0.30 (30 %) | Con grales (`0.13`) alcanza `0.30` exacto |
| 106 | `tech_civ_griegos_a` | Falange hoplita | `civilizacion` | 3 | 500 / 300 / 200 / 400 / 0 | 1400 | 480s | 288s / 260s | castillo:3 | tech_civ_griegos | `griegos` | `unitEfficiencyInf` = `0.08` (Eficacia de infantería +8 %) | 0.30 (30 %) | — |
| 107 | `tech_civ_griegos_b` | Academias de filosofía | `civilizacion` | 3 | 800 / 200 / 200 / 100 / 0 | 1300 | 480s | 288s / 260s | castillo:3 | tech_civ_griegos | `griegos` | `researchDuration` = `-0.05` (−5 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | Se anula al saturar `educ_1..4` (−40 %) |
| 108 | `tech_civ_griegos_c` | Arqueros cretenses | `civilizacion` | 5 | 1400 / 400 / 560 / 900 / 0 | 3260 | 900s | 540s / 487s | castillo:6 | tech_civ_griegos_a, tech_civ_griegos_b | `griegos` | `unitEfficiencyArc` = `0.15` (Eficacia de arqueros +15 %) | 0.30 (30 %) | — |
| 109 | `tech_civ_vikingos_a` | Navegación estelar | `civilizacion` | 3 | 700 / 600 / 0 / 0 / 0 | 1300 | 480s | 288s / — | castillo:3 | tech_civ_vikingos | `vikingos` | `goldProduction` = `0.08` (+8 % producción de oro) | 0.60 (60 %) | — |
| 110 | `tech_civ_vikingos_b` | Forja de acero nórdico | `civilizacion` | 3 | 400 / 100 / 0 / 800 / 0 | 1300 | 480s | 288s / — | castillo:3 | tech_civ_vikingos | `vikingos` | `unitEfficiencyInf` = `0.08` (Eficacia de infantería +8 %) | 0.30 (30 %) | — |
| 111 | `tech_civ_vikingos_c` | Furia de los Berserkers | `civilizacion` | 5 | 1600 / 700 / 0 / 600 / 0 | 2900 | 900s | 540s / — | castillo:6 | tech_civ_vikingos_a, tech_civ_vikingos_b | `vikingos` | `combatAttack` = `0.12` (+12 % ataque militar total) | 0.25 (25 %) | — |
| 112 | `tech_civ_bizantinos_a` | Muros Teodosianos | `civilizacion` | 3 | 300 / 100 / 1000 / 200 / 0 | 1600 | 480s | 288s / — | castillo:3 | tech_civ_bizantinos | `bizantinos` | `combatDefense` = `0.08` (+8 % defensa militar) | 0.25 (25 %) | — |
| 113 | `tech_civ_bizantinos_b` | Diplomacia imperial | `civilizacion` | 3 | 800 / 0 / 0 / 0 / 0 | 800 | 480s | 288s / — | castillo:3 | tech_civ_bizantinos | `bizantinos` | `goldProduction` = `0.1` (+10 % producción de oro) | 0.60 (60 %) | — |
| 114 | `tech_civ_bizantinos_c` | Catafractos imperiales | `civilizacion` | 5 | 1800 / 400 / 400 / 900 / 0 | 3500 | 900s | 540s / — | castillo:6 | tech_civ_bizantinos_a, tech_civ_bizantinos_b | `bizantinos` | `unitEfficiencyCav` = `0.12` (Eficacia de caballería +12 %) | 0.30 (30 %) | — |
| 115 | `tech_civ_arabes_a` | Sabiduría de la Casa | `civilizacion` | 3 | 900 / 100 / 100 / 100 / 0 | 1200 | 480s | 288s / — | castillo:3 | tech_civ_arabes | `arabes` | `researchDuration` = `-0.06` (−6 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | Se anula al saturar `educ_1..4` (−40 %) |
| 116 | `tech_civ_arabes_b` | Comercio de caravanas | `civilizacion` | 3 | 600 / 200 / 100 / 0 / 0 | 900 | 480s | 288s / — | castillo:3 | tech_civ_arabes | `arabes` | `goldProduction` = `0.12` (+12 % producción de oro) | 0.60 (60 %) | — |
| 117 | `tech_civ_arabes_c` | Tácticas de desierto | `civilizacion` | 5 | 1300 / 400 / 200 / 500 / 0 | 2400 | 900s | 540s / — | castillo:6 | tech_civ_arabes_a, tech_civ_arabes_b | `arabes` | `unitEfficiencyAll` = `0.1` (Eficacia de las tres armas +10 %) | 0.30 (30 % c/u) | — |
| 118 | `tech_civ_mongoles_a` | Yasa y disciplina de la horda | `civilizacion` | 3 | 400 / 200 / 100 / 100 / 0 | 800 | 480s | 288s / — | castillo:3, cuartel:3 | tech_civ_mongoles | `mongoles` | `moraleBase` = `4` (Moral militar +4 puntos) | 15 pts | Solo aplica en combate |
| 119 | `tech_civ_mongoles_b` | Correo Yam | `civilizacion` | 3 | 600 / 300 / 0 / 0 / 0 | 900 | 480s | 288s / — | castillo:3 | tech_civ_mongoles | `mongoles` | `marchSpeed` = `0.1` (+10 % velocidad de marcha) | 0.55 (55 %) | Omitido en `army.ts:launchAttack` |
| 120 | `tech_civ_mongoles_c` | Arqueros a caballo de élite | `civilizacion` | 5 | 1600 / 400 / 200 / 700 / 0 | 2900 | 900s | 540s / — | castillo:6, cuartel:5 | tech_civ_mongoles_a, tech_civ_mongoles_b | `mongoles` | `unitEfficiencyCav` = `0.15` (Eficacia de caballería +15 %) | 0.30 (30 %) | — |
| 121 | `tech_civ_chinos_a` | Exámenes imperiales | `civilizacion` | 3 | 700 / 200 / 200 / 50 / 0 | 1150 | 480s | 288s / — | castillo:3, universidad:3 | tech_civ_chinos | `chinos` | `researchDuration` = `-0.05` (−5 % duración de investigaciones) | 0.40 (-40 %, floor 0.60) | Se anula al saturar `educ_1..4` (−40 %) |
| 122 | `tech_civ_chinos_b` | Ballestas de repetición | `civilizacion` | 3 | 500 / 300 / 100 / 300 / 0 | 1200 | 480s | 288s / — | castillo:3, herreria:3 | tech_civ_chinos | `chinos` | `unitEfficiencyArc` = `0.08` (Eficacia de arqueros +8 %) | 0.30 (30 %) | — |
| 123 | `tech_civ_chinos_c` | Mandato del Cielo | `civilizacion` | 5 | 1800 / 600 / 800 / 200 / 0 | 3400 | 900s | 540s / — | castillo:6 | tech_civ_chinos_a, tech_civ_chinos_b | `chinos` | `happinessBase` = `6` (+6 felicidad base) | 30 pts | — |
| 124 | `tech_civ_japoneses_a` | Código Bushido | `civilizacion` | 3 | 500 / 200 / 100 / 100 / 0 | 900 | 480s | 288s / — | castillo:3 | tech_civ_japoneses | `japoneses` | `moraleBase` = `5` (Moral militar +5 puntos) | 15 pts | Solo aplica en combate |
| 125 | `tech_civ_japoneses_b` | Maestros forjadores | `civilizacion` | 3 | 400 / 100 / 100 / 600 / 0 | 1200 | 480s | 288s / — | castillo:3, herreria:3 | tech_civ_japoneses | `japoneses` | `unitEfficiencyInf` = `0.08` (Eficacia de infantería +8 %) | 0.30 (30 %) | — |
| 126 | `tech_civ_japoneses_c` | Shogunato | `civilizacion` | 5 | 2000 / 500 / 500 / 800 / 0 | 3800 | 900s | 540s / — | castillo:6 | tech_civ_japoneses_a, tech_civ_japoneses_b | `japoneses` | `combatAttack` = `0.1` (+10 % ataque militar) | 0.25 (25 %) | — |
| 127 | `tech_civ_navajos_a` | Sabiduría del coyote | `civilizacion` | 3 | 400 / 200 / 100 / 50 / 0 | 750 | 480s | 288s / — | castillo:3 | tech_civ_navajos | `navajos` | `espionageAccuracy` = `1` (+1 nivel de espionaje (requiere espionaje activo, máx nivel 4)) | 4 (nivel máx) | Nulo sin `espionage_1` o con `espionage_4` |
| 128 | `tech_civ_navajos_b` | Tejedores de sueños | `civilizacion` | 3 | 400 / 400 / 100 / 20 / 0 | 920 | 480s | 288s / — | castillo:3 | tech_civ_navajos | `navajos` | `happinessBase` = `4` (+4 felicidad base) | 30 pts | — |
| 129 | `tech_civ_navajos_c` | El Gran Camino del Bosque | `civilizacion` | 5 | 1400 / 900 / 400 / 100 / 0 | 2800 | 900s | 540s / — | castillo:6 | tech_civ_navajos_a, tech_civ_navajos_b | `navajos` | `marchSpeed` = `0.12` (+12 % velocidad de marcha) | 0.55 (55 %) | Omitido en `army.ts:launchAttack` |
| 130 | `tech_civ_aztecas_a` | Sacrificios rituales | `civilizacion` | 3 | 400 / 200 / 300 / 20 / 0 | 920 | 480s | 288s / — | castillo:3, iglesia:3 | tech_civ_aztecas | `aztecas` | `moraleBase` = `5` (Moral militar +5 puntos) | 15 pts | Solo aplica en combate |
| 131 | `tech_civ_aztecas_b` | Guerreros Jaguar y Águila | `civilizacion` | 3 | 500 / 200 / 100 / 100 / 0 | 900 | 480s | 288s / — | castillo:3, cuartel:3 | tech_civ_aztecas | `aztecas` | `unitEfficiencyInf` = `0.1` (Eficacia de infantería +10 %) | 0.30 (30 %) | — |
| 132 | `tech_civ_aztecas_c` | Imperio de la Triple Alianza | `civilizacion` | 5 | 1600 / 500 / 500 / 200 / 0 | 2800 | 900s | 540s / — | castillo:6 | tech_civ_aztecas_a, tech_civ_aztecas_b | `aztecas` | `goldProduction` = `0.15` (+15 % producción de oro) | 0.60 (60 %) | — |
| 133 | `tech_civ_masais_a` | Guerreros Morani | `civilizacion` | 3 | 400 / 200 / 100 / 50 / 0 | 750 | 480s | 288s / — | castillo:3, cuartel:3 | tech_civ_masais | `masais` | `unitEfficiencyInf` = `0.1` (Eficacia de infantería +10 %) | 0.30 (30 %) | — |
| 134 | `tech_civ_masais_b` | Ganadería trashumante | `civilizacion` | 3 | 300 / 400 / 100 / 20 / 0 | 820 | 480s | 288s / — | castillo:3 | tech_civ_masais | `masais` | `foodConsumption` = `-0.06` (Consumo de alimentos −6 %) | 0.15 (-15 %) | — |
| 135 | `tech_civ_masais_c` | El Gran Salto | `civilizacion` | 5 | 1200 / 600 / 400 / 100 / 0 | 2300 | 900s | 540s / — | castillo:6 | tech_civ_masais_a, tech_civ_masais_b | `masais` | `moraleBase` = `6` (Moral militar +6 puntos) | 15 pts | Solo aplica en combate |

*(Nota de catálogo: la línea 1134 de `convex/balanceConfig.ts` documenta explícitamente: `// NOTA: form_1-7, forge_1, forge_6 aplazados y sin implementar (efectos formationEfficiency/equipmentWear inexistentes en el motor).`)*

---

## 3. Organización por Ramas y Fichas por Civilización

### 3.1 Distribución por Rama y Nivel de Universidad

| Rama | Univ. 1 | Univ. 2 | Univ. 3 | Univ. 4 | Univ. 5 | Total Nodos | Subcadenas principales |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `economica` | 3 | 2 | 8 | 6 | 7 | **26** | `agri_1..8` (8), `mining_1..9` (9), `storage_1..3` (3), `trade_1..4` (4), `merc_1..2` (2) |
| `civil` | 2 | 3 | 6 | 5 | 5 | **21** | `construction_1..8` (8), `educ_1..6` (6), `happiness_1..7` (7) |
| `militar` | 1 | 5 | 8 | 10 | 8 | **32** | `training_1..5` (5), `medicine/medical` (7), `weapons/armor/forge` (7), `logistics_1..6` (6), `tactics_*` (7) |
| `inteligencia` | 0 | 2 | 1 | 3 | 2 | **8** | `espionage_1..4` (4), `spy_1..4` (4) |
| `civilizacion` | 0 | 12 | 24 | 0 | 12 | **48** | 12 cadenas simétricas de 4 nodos: raíz (Univ 2) → ramas `_a` y `_b` (Univ 3) → ápice `_c` (Univ 5) |
| **Total** | **6** | **24** | **47** | **25** | **33** | **135** | **87 universales + 48 exclusivas** |

### 3.2 Fichas por las 12 Civilizaciones (Pasiva + Cadena de 4 Tecnologías)

Todas las civilizaciones comparten la misma estructura temporal en su rama exclusiva: **420 s + 480 s + 480 s + 900 s = 2.280 s base** (`38 minutos` sin reducción; `1.368 s = 22m 48s` con tope `-40 %`, y `1.234 s = 20m 34s` para Griegos con `0,54`). Sin embargo, los costes varían notablemente entre **4.350 recursos totales** (Masáis) y **6.610 recursos totales** (Romanos).

| Civilización | Pasiva Cultural (`balanceConfig.ts`) | Debilidad (`weakness`) | Cadena Exclusiva (Univ 2 → Univ 3 `_a`/`_b` → Univ 5 `_c`) | Coste Propio (O/M/P/H) | Total Propio | Total Reino (91 techs) |
| --- | --- | --- | --- | --- | ---: | ---: |
| **Ingleses** (`ingleses`) | +10 % madera, −10 % tiempo arquería | +15 % coste caballería | `combatAttack +5%` → `unitEfficiencyArc +8%` / `agricultureProduction +10%` → `combatAttack +12%` | 2.500 / 1.750 / 680 / 550 | **5.480** | 126.200 |
| **Romanos** (`romanos`) | +10 % piedra, −10 % tiempo construcción | +10 % tiempo caballería | `combatDefense +5%` → `unitEfficiencyInf +8%` / `constructionDuration -6%` → `unitEfficiencyInf +9%` | 2.500 / 580 / 2.050 / 1.480 | **6.610** | 127.330 |
| **Griegos** (`griegos`) | −10 % tiempo investigación (`×0,90`), +5 felicidad | +10 % coste caballería | `combatDefense +5%` → `unitEfficiencyInf +8%` / `researchDuration -5%` → `unitEfficiencyArc +15%` | 2.950 / 1.000 / 1.110 / 1.460 | **6.520** | 127.240 |
| **Vikingos** (`vikingos`) | −15 % tiempo exploración, +10 % almacén | +15 % tiempo asedio | `combatAttack +5%` → `goldProduction +8%` / `unitEfficiencyInf +8%` → `combatAttack +12%` | 2.880 / 1.700 / 80 / 1.460 | **6.120** | 126.840 |
| **Bizantinos** (`bizantinos`) | +10 % oro, +5 % defensa militar | +15 % coste caballería | `combatDefense +6%` → `combatDefense +8%` / `goldProduction +10%` → `unitEfficiencyCav +12%` | 3.200 / 600 / 1.600 / 1.200 | **6.600** | 127.320 |
| **Árabes** (`arabes`) | +8 pp recuperación heridos, +5 % oro | +10 % tiempo infantería | `woundedRecovery +10pp` → `researchDuration -6%` / `goldProduction +12%` → `unitEfficiencyAll +10%` | 3.050 / 820 / 520 / 640 | **5.030** | 125.750 |
| **Mongoles** (`mongoles`) | +15 % velocidad marcha, −10 % tiempo caballería | −5 % defensa combate | `marchSpeed +15%` → `moraleBase +4` / `marchSpeed +10%` → `unitEfficiencyCav +15%` | 2.800 / 1.050 / 380 / 850 | **5.080** | 125.800 |
| **Chinos** (`chinos`) | +8 % agricultura, +5 % cap. residencial | +10 % coste caballería | `combatDefense +6%` → `researchDuration -5%` / `unitEfficiencyArc +8%` → `happinessBase +6` | 3.220 / 1.250 / 1.400 / 600 | **6.470** | 127.190 |
| **Japoneses** (`japoneses`) | +10 % hierro, +5 % ataque militar | +10 % tiempo asedio | `combatAttack +5%` → `moraleBase +5` / `unitEfficiencyInf +8%` → `combatAttack +10%` | 3.150 / 900 / 800 / 1.620 | **6.470** | 127.190 |
| **Navajos** (`navajos`) | −20 % coste exploración, +8 % madera | +10 % tiempo asedio | `marchFatigue -20%` → `espionageAccuracy +1` / `happinessBase +4` → `marchSpeed +12%` | 2.350 / 1.750 / 700 / 200 | **5.000** | 125.720 |
| **Aztecas** (`aztecas`) | +12 % agricultura, +4 felicidad | +15 % tiempo caballería | `agricultureProduction +8%` → `moraleBase +5` / `unitEfficiencyInf +10%` → `goldProduction +15%` | 2.700 / 1.100 / 1.050 / 350 | **5.200** | 125.920 |
| **Masáis** (`masais`) | −25 % fatiga marcha, +6 % agricultura | −5 % defensa combate | `marchFatigue -25%` → `unitEfficiencyInf +10%` / `foodConsumption -6%` → `moraleBase +6` | 2.060 / 1.380 / 700 / 210 | **4.350** | 125.070 |

---

## 4. Fórmulas Matemáticas Exactas del Sistema

### 4.1 Costes de Investigación
- **Modelo plano sin escalado**: cada nodo representa un único nivel fijo con `costs: { gold, wood, stone, iron, food }`. No existe fórmula exponencial por nivel ni descuento por tecnología/civilización sobre el coste de investigar (`createResearchPlan`, `convex/technologyRules.ts:309-322`).
- **Validación de saldo**: para todo recurso con `cost > 0`, exige `balance >= cost` después de ejecutar `settleRelationalKingdomEconomy` (`technologies.ts:116`).

### 4.2 Ranuras Simultáneas de Investigación
Implementado en `researchSlots(universityLevel)` (`convex/technologyRules.ts:52-58`) usando `RESEARCH_SLOTS_BY_UNIVERSITY` (`balanceConfig.ts`) y `RESEARCH`:
$$
\text{slots}(u) = \begin{cases}
0 & \text{si } u \le 0 \text{ o } u \notin \mathbb{Z} \\
1 & \text{si } u \in \{1, 2\} \\
2 & \text{si } u \in \{3, 4\} \\
3 & \text{si } u \ge 5 \quad (\text{tope } \text{RESEARCH.MAX\_SLOTS} = 3)
\end{cases}
$$

### 4.3 Duración de Investigación y Redondeo (Discrepancia Query vs Mutation)
- **Factor tecnológico**:
  $$M_{\text{tech}} = \max\!\left(1 - 0{,}40,\; 1 + \sum_{t \in \text{researchDuration}} \text{value}(t)\right) = \max(0{,}60,\; 1 + \sum \text{value})$$
- **Factor cultural**: $M_{\text{civ}} = \text{civPassive.researchDurationMultiplier}$ (`0.90` para `griegos`, `1.00` para el resto). Combinación **multiplicativa**: mínimo efectivo = $0{,}60 \times 0{,}90 = 0{,}54$ (`-46 %`).
- **Discrepancia real de redondeo**:
  - **UI / Query (`technologies.ts:92`)**:
    $$\text{bonifiedDurationSeconds} = \max\!\left(1,\; \lceil \text{durationSeconds} \cdot M_{\text{tech}} \cdot M_{\text{civ}} \rceil\right)$$
  - **Mutation real (`technologyRules.ts:326`)**:
    $$\text{durationMs} = \lceil \text{durationSeconds} \cdot 1000 \cdot M_{\text{tech}} \cdot M_{\text{civ}} \rceil$$
  - Esto provoca **137 discrepancias** entre lo mostrado en la UI y los milisegundos reales descontados bajo factores `0.90`, `0.60` y `0.54`, incluyendo artefactos de coma flotante IEEE-754: por ejemplo `agri_1` (`30s`) con factor `0.54` (`0.60 * 0.90`) evalúa `30 * 1000 * 0.54 = 16200.000000000002`, produciendo `durationMs = 16.201 ms`, mientras `getTechnologies` muestra `17 s` (`17.000 ms`).

### 4.4 Progreso y Cancelación con Reembolso
- **Progreso (`technologyRules.ts:334-339`)**:
  $$\text{progress}(t) = \text{clamp}\!\left(\frac{t - \text{startedAt}}{\text{durationMs}} \times 100,\; 0,\; 100\right)$$
- **Cancelación (`technologyRules.ts:342-358`)**: bloqueada si `progress >= 100`. Para cada recurso pagado:
  $$\text{refund}_r = \lfloor \text{paid}_r \times \text{RESEARCH.CANCEL\_REFUND\_RATIO} \rfloor = \lfloor \text{paid}_r \times 0{,}50 \rfloor$$

### 4.5 Fórmulas de Agregación de Modificadores (`computeTechnologyModifiers`, `technologyRules.ts:95-215`)
- **Idempotencia**: utiliza `Set` sobre `normalizeTechnologyId(rawId)`, ignorando duplicados e IDs inexistentes.
- **Suma aditiva positiva con techo (`min(CAP, max(0, sum))`)**:
  - `agricultureProduction`: `1 + min(0.65, max(0, sum))`
  - `miningProduction`: `1 + min(0.50, max(0, sum))`
  - `storageCapacity`: `1 + min(1.00, max(0, sum))`
  - `woundedRecoveryBonus`: `min(0.60, max(0, sum))`
  - `happinessBase`: `min(30, sum)` *(sin `max(0, ...)` pero todos los valores son positivos)*
  - `combatAttackBonus`: `min(0.25, sum)` *(consumidor aplica `1 + max(0, val)`)*
  - `combatDefenseBonus`: `min(0.25, sum)`
  - `marchSpeedBonus`: `min(0.55, sum)`
  - `woodProductionBonus`, `stoneProductionBonus`, `ironProductionBonus`: `min(0.30, max(0, sum))`
  - `goldProductionBonus`: `min(0.60, max(0, sum))`
  - `housingCapacityBonus`: `min(0.30, max(0, sum))`
  - `moraleBase`: `min(15, sum)`
  - `unitEfficiencyInf`, `unitEfficiencyArc`, `unitEfficiencyCav`: `min(0.30, max(0, sum))` *(donde `unitEfficiencyAll` suma a las 3 simultáneamente)*
  - `woundedRateBonus`: `min(0.20, max(0, sum))`
  - `counterEspionage`: `min(0.60, max(0, sum))`
- **Reducciones almacenadas con `Math.abs(value)` (suma positiva acotada)**:
  - `marchFatigueReduction`: `min(0.50, sum(|v|))`
  - `foodConsumptionReduction`: `min(0.15, max(0, sum(|v|)))`
  - `taxToleranceReduction`: `min(0.50, max(0, sum(|v|)))`
  - `mercenaryCostReduction`: `min(0.30, max(0, sum(|v|)))`
  - `fatigueAccrualReduction`: `min(0.30, max(0, sum(|v|)))`
- **Multiplicadores con piso (valores negativos en catálogo)**:
  - `trainingDuration`: `max(0.60, 1 + sum)`
  - `constructionDuration`: `max(0.60, 1 + sum)`
  - `researchDuration`: `max(1 - 0.40, 1 + sum)` = `max(0.60, 1 + sum)`
  - `constructionCost`: `max(1 - 0.25, 1 + sum)` = `max(0.75, 1 + sum)`
- **Espionaje (`espionageAccuracy`)**:
  $$\text{espionageLevel} = \begin{cases}
  0 & \text{si } \max(\text{base}) = 0 \\
  \min\!\left(4,\; \max(\text{base}) + \mathbb{1}_{\text{tech\_civ\_navajos\_a}}\right) & \text{si } \max(\text{base}) > 0
  \end{cases}$$
  *(Si un Navajo solo investiga `tech_civ_navajos_a` sin `espionage_1`, `espionageLevel` sigue siendo `0`.)*

### 4.6 Fórmulas en los Motores Consumidores (Aditivo vs. Multiplicativo)

| Dominio | Archivo y línea | Fórmula exacta aplicada | Tipo de apilamiento |
| --- | --- | --- | --- |
| Agricultura | `economyExtended.ts:331-335` | `RESOURCE_PRODUCTION_MULTIPLIERS.agriculture × tech.agricultureProduction × (1 + terrain.agriculture) × (1 + civ.agriculture) × productivity` | **Multiplicativo** entre capas |
| Consumo alimentos | `economyExtended.ts:333-334` | `professions.foodConsumptionMultiplier × (1 - min(0.15, tech.foodConsumptionReduction))` | **Multiplicativo** (panadería × tech) |
| Madera/Piedra/Hierro | `economyExtended.ts:354-365` | `rate = base × betaMul × [tech.miningProduction × (1 + resourceSpecificBonus)] × (1 + terrain) × (1 + civ) × productivity` | **Multiplicativo** (`mining` × específico × terreno × civ) |
| Oro e impuestos | `economyExtended.ts:346,364,371` | `goldTechMul = 1 + min(0.60, tech.goldProductionBonus)`; `taxIncome = taxableBase × taxRate × goldTechMul` | **Multiplicativo** en minas y recaudación fiscal |
| Capacidad almacén | `economyExtended.ts:382-383` | `storageCapacity(mercado, tech.storageCapacity × civ.storageCapacityMultiplier)` | **Multiplicativo** (tech × Vikingos) |
| Capacidad residencial | `buildingRules.ts:168`, `economyExtended.ts:413` | `ceil(round(base × (1 + tech.housingCapacityBonus)) × civ.residentialCapacityMultiplier)` | **Multiplicativo** (redondeo doble `round` luego `ceil`) |
| Tolerancia fiscal | `economyExtended.ts:165-181,322` | `taxPenalty = basePenalty × (1 - clamp(taxTolerance, 0, 1))` (aplica en productividad y moral) | **Multiplicativo** reductor de penalización |
| Felicidad diaria | `economyExtended.ts:485,495` | `equilibrium = 70 + tech.happinessBase + civ.happinessBonus`; si `dailyDelta === 0 && happinessBefore < equilibrium && tech.happinessBase > 0`, `+1/día` | **Aditivo** sobre el equilibrio |
| Duración construcción | `buildings.ts:86-89,154-157`, `buildingRules.ts:83` | `ceil(baseMs × (1 + 0.01×(lvl-1)) × tech.constructionDuration × workersMod × civ.constructionDurationMultiplier)` | **Multiplicativo** (puede bajar de `0.50`: `0.60×0.80×0.90 = 0.432`) |
| Coste construcción | `buildings.ts:158`, `buildingRules.ts:94` | `round(base × 1.15^(lvl-1) × max(0.75, min(1, tech.constructionCost)))` | **Multiplicativo** con crecimiento nivel |
| Duración entrenamiento | `army.ts:424`, `armyRules.ts:123-125` | `ceil(perUnitMs × count × max(0.50, tech.trainingDuration × civDuration))` | **Multiplicativo** con piso global `0.50` |
| Coste mercenarios | `armyRules.ts:558` | `max(0, floor(type.goldPerUnit × count × (1 - tech.mercenaryCostReduction)))` | **Aditivo interno, multiplicativo sobre base** |
| Fuerza de unidades | `battleRules.ts:168-174` | `attack *= (1 + eff)`, `defense *= (1 + eff)` donde `eff` es `unitEfficiency{Inf/Arc/Cav}` (incluye `unitEfficiencyAll`) | **Multiplicativo** por arma |
| Ataque/Defensa combate | `battleRules.ts:230-233` | `off = rawOff × civ.combatAttackMultiplier × (1 + tech.combatAttackBonus)`; `def = rawDef × civ.combatDefenseMultiplier × (1 + tech.combatDefenseBonus)` | **Multiplicativo** (civ × tech) |
| Moral en batalla | `battleRules.ts:241` | `moraleFactor(min(100, side.morale + (side.moraleBase ?? 0)))` | **Aditivo** antes de tope 100 |
| Bajas a heridos | `battleRules.ts:297-302` | `round(casualties[type] × clamp(0.65 + tech.woundedRateBonus, 0, 1))` | **Aditivo** en pp sobre `0.65` |
| Recuperación heridos | `battleRules.ts:573-577,619-626` | `min(0.60, hospitalBase + max(0, tech.woundedRecoveryBonus + medicsBonus + civBonus))` | **Aditivo** en pp con tope `0.60` |
| Fatiga de marcha | `territoryRules.ts:2677-2680` | `ceil(2 × d × terrainMul × civFatigue × max(0.1, (1 - min(0.5, marchFatigue)) × (1 - min(0.3, fatigueAccrual))))` | **Multiplicativo** entre las 3 capas |
| Velocidad de marcha | `territoryRules.ts:2659-2661` | `effectiveSpeed = max(0.1, civSpeed × (1 + max(0, techSpeedBonus)))` | **Multiplicativo** (ver fallo en `army.ts:1185`) |
| Espionaje / Contraesp. | `parliament.ts:367-372` | `counterProb = max(0, target.counterEspionage - 0.05×(spies-1))`; `effLvl = min(4, spyLvl + floor((spies-1)/2))`; si acierta contraesp., `-1` (mín `1`) | **Aditivo** (penalizado por cantidad espías) |

---

## 5. Análisis de Saturación de Topes (`TECH_EFFECT_CAPS`) y Comparativa Completa

Al sumar todas las tecnologías disponibles para cada civilización (87 generales + 4 propias = 91 nodos), varios topes definidos en `TECH_EFFECT_CAPS` (`convex/balanceConfig.ts:941-969`) quedan **saturados o desperdician puntos porcentuales**:

| Clave de efecto | Tope (`TECH_EFFECT_CAPS`) | Suma General (87 techs) | Civ(s) que aportan extra | Suma Máx. Teórica | ¿Satura / Desperdicia? |
| --- | --- | ---: | --- | ---: | --- |
| `agricultureProduction` | `0.65` | `+0.49` | Ingleses (`+0.10`), Aztecas (`+0.08`) | `0.59` (Ingleses) | No (margen +0.06) |
| `miningProduction` | `0.50` | `+0.26` | — | `0.26` | No (margen +0.24) |
| `woodProduction` | `0.30` | `+0.10` | — | `0.10` | No (margen +0.20) |
| `stoneProduction` | `0.30` | `+0.10` | — | `0.10` | No (margen +0.20) |
| `ironProduction` | `0.30` | `+0.10` | — | `0.10` | No (margen +0.20) |
| `goldProduction` | `0.60` | `+0.36` | Aztecas (`+0.15`), Árabes (`+0.12`), Bizantinos (`+0.10`), Vikingos (`+0.08`) | `0.51` (Aztecas) | No (margen +0.09) |
| `foodConsumption` | `0.15` | `-0.04` | Masáis (`-0.06`) | `-0.10` (Masáis) | No (margen 0.05) |
| `storageCapacity` | `1.00` | `+0.55` | — | `0.55` | No (margen +0.45) |
| `constructionDuration` | `0.60` floor (`-0.40`) | `-0.24` | Romanos (`-0.06`) | `-0.30` (Romanos) | No (margen -0.10) |
| `constructionCost` | `0.25` (`-25 %`) | **`-0.31`** | — | **`-0.31`** | **SÍ SATURA**: desperdicia **6 pp** en la rama general (`construction_8` sobra) |
| `researchDuration` | `0.40` (`-40 %`) | **`-0.48`** | Griegos (`-0.05`), Árabes (`-0.06`), Chinos (`-0.05`) | **`-0.54`** (Árabes) | **SÍ SATURA**: rama gral desperdicia **8 pp**; anula por completo las techs `_b`/`_a` de Griegos, Árabes y Chinos |
| `housingCapacity` | `0.30` | **`0.00`** | — | **`0.00`** | **AUSENTE**: tope y lógica existen, **0 tecnologías** la otorgan |
| `happinessBase` | `30` | `22` | Chinos (`+6`), Navajos (`+4`) | `28` (Chinos) | No (margen +2) |
| `taxTolerance` | `0.50` | `0.50` | — | `0.50` | Satura exacto en 1 tech (`happiness_5`) |
| `trainingDuration` | `0.60` floor (`-0.40`) | `-0.29` | — | `-0.29` | No (margen -0.11) |
| `woundedRecovery` | `0.60` | `+0.15` | Árabes (`+0.10`) | `0.25` (Árabes) | No (margen +0.35) |
| `woundedRate` | `0.20` | `+0.15` | — | `0.15` | No (margen +0.05) |
| `combatAttack` | `0.25` | `+0.06` | Ingleses (`+0.17`), Vikingos (`+0.17`), Japoneses (`+0.15`) | `0.23` (Ing/Vik) | No (muy cerca, margen +0.02) |
| `combatDefense` | `0.25` | `+0.07` | Bizantinos (`+0.14`), Chinos (`+0.06`), Romanos (`+0.05`), Griegos (`+0.05`) | `0.21` (Bizantinos) | No (margen +0.04) |
| `marchSpeed` | `0.55` | `+0.20` | Mongoles (`+0.25`), Navajos (`+0.12`) | `0.45` (Mongoles) | No (margen +0.10) |
| `marchFatigue` | `0.50` | `0.20` | Masáis (`+0.25`), Navajos (`+0.20`) | `0.45` (Masáis) | No (margen +0.05) |
| `fatigueAccrual` | `0.30` | `0.11` | — | `0.11` | No (margen +0.19) |
| `moraleBase` | `15` | `9` | Masáis (`+6`), Japoneses (`+5`), Aztecas (`+5`), Mongoles (`+4`) | **`15`** (Masáis) | Satura exacto en Masáis (`15/15`) |
| `unitEfficiencyInf` | `0.30` | `0.09` + `0.04` (`All`) = `0.13` | Romanos (`+0.17`), Aztecas (`+0.10`), Masáis (`+0.10`), Árabes (`+0.10 All`), Gr/Vik/Jap (`+0.08`) | **`0.30`** (Romanos) | Satura exacto en Romanos (`0.30/0.30`) |
| `unitEfficiencyArc` | `0.30` | `0.09` + `0.04` (`All`) = `0.13` | Griegos (`+0.15`), Árabes (`+0.10 All`), Ingleses/Chinos (`+0.08`) | `0.28` (Griegos) | No (margen +0.02) |
| `unitEfficiencyCav` | `0.30` | `0.09` + `0.04` (`All`) = `0.13` | Mongoles (`+0.15`), Bizantinos (`+0.12`), Árabes (`+0.10 All`) | `0.28` (Mongoles) | No (margen +0.02) |
| `mercenaryCost` | `0.30` | `0.18` | — | `0.18` | No (margen +0.12) |
| `espionageAccuracy` | `4` | `max = 4` (`1..4`) | Navajos (`+1` aditivo) | **`4`** (`min(4, 4+1)`) | **SÍ SATURA**: con `espionage_4`, `tech_civ_navajos_a` aporta **0** |
| `counterEspionage` | `0.60` | `+0.37` | — | `0.37` | No (margen +0.23) |

---

## 6. Grafo de Dependencias (DAG) y Validación Estructural

Se ejecutó validación programática completa sobre las 135 definiciones de `TECHNOLOGIES`:
- **Ciclos detectados:** `0` (`cycles: []`).
- **Auto-dependencias:** `0` (`selfDeps: []`).
- **Prerrequisitos inexistentes:** `0` (`missingPrereqs: []`).
- **Dependencias cruzadas entre civilizaciones:** `0` (`crossCiv: []`).
- **Inversiones de `universityLevel` (hijo < padre):** `0` (`reqViolations: []`).
- **Profundidad máxima del grafo:** 8 niveles topológicos (distribución por profundidad: D1=24, D2=51, D3=32, D4=18, D5=6 [`agri_7`, `mining_9`, `trade_4`, `construction_5`, `educ_6`, `logistics_6`], D6=2 [`agri_8`, `construction_6`], D7=1 [`construction_7`], D8=1 [`construction_8`]).

### Particularidades estructurales detectadas en el grafo
1. **Redundancia de `universidad` en `buildingRequirements`**: 64 tecnologías declaran `universidad: X` además de `universityLevel: X` (siempre coinciden en nivel; `evaluateTechnologyStatus` en `technologyRules.ts:248` omite explícitamente `buildingType === "universidad"` cuando `reqLevel <= technology.universityLevel`). Las otras 71 tecnologías no repiten `universidad` dentro de `buildingRequirements`.
2. **Omisión explícita de `castillo` en 2 nodos intermedios**: `medical_2` (Univ 3, prereq `medicine_1` que exige `castillo:2`) y `espionage_2` (Univ 4, prereq `espionage_1` que exige `castillo:2`) omiten `castillo` en su `buildingRequirements`. En la práctica sigue siendo imposible investigarlos sin Castillo ≥ 3 o 4 porque `universidad` requiere `castillo >= universidad` (`CONSTRUCTION.CASTLE_CAPS_LEVELS = true`) y además sus prerrequisitos piden `castillo: 2`.
3. **Nomenclatura inconsistente de medicina**: coexisten `medical_2` (#47, `woundedRecovery +0.10`), `medicine_2` (#93, `woundedRate +0.04`) y `medicine_3` (#48, `happinessBase +2`) junto a `medical_3` (#94, `woundedRate +0.05`). No colisionan sus IDs, pero inducen a error durante ampliaciones futuras.
4. **Convención de signos inconsistente en `marchFatigue`**: `logistics_1` y `logistics_6` usan valores negativos (`-0.10`), mientras `tech_civ_navajos` (`0.20`) y `tech_civ_masais` (`0.25`) usan valores positivos. No rompe en runtime porque `technologyRules.ts:158` aplica `Math.abs(value)`.
5. **Dependencia cruzada entre ramas**: `merc_1` (rama `economica`) exige `training_1` (rama `militar`), y `merc_2` exige `merc_1` y `trade_2`.

---

## 7. Auditoría de Aplicación Real de los 33 `TechnologyEffectKey`

| # | Clave (`TechnologyEffectKey`) | Nº Techs | Campo en `TechnologyModifiers` | Consumidor(es) Real(es) | Estado de Aplicación |
| ---: | --- | ---: | --- | --- | --- |
| 1 | `agricultureProduction` | 8 | `agricultureProduction` | `economy.ts:238` → `economyExtended.ts:332` | **INCOMPLETO**: aplica en liquidación real (`settleRelationalKingdomEconomy`), pero **OMITIDO en queries `economy:getKingdom` y `economy:getSimulatedKingdomResources`** (`economy.ts:1015,1103`, `economyAdapter.ts:636`). |
| 2 | `foodConsumption` | 2 | `foodConsumptionReduction` | `economy.ts:238` → `economyExtended.ts:333-335` | **INCOMPLETO**: mismo fallo en queries de proyección `getKingdom` y `getSimulatedKingdomResources`. |
| 3 | `storageCapacity` | 5 | `storageCapacity` | `economyExtended.ts:382`, `compensation.ts:152,340` | **INCOMPLETO**: **OMITIDO en `missions.ts:120,267`** (`claimMissionReward` y `grantReward` llaman `storageCapacity(market)` sin bono tecnológico ni cultural, pudiendo lanzar falsamente `"NO HAY SITIO EN EL MERCADO"`). |
| 4 | `miningProduction` | 4 | `miningProduction` | `economyExtended.ts:360` | **CORRECTO** |
| 5 | `woodProduction` | 1 | `woodProductionBonus` | `economyExtended.ts:354,360` | **CORRECTO** |
| 6 | `stoneProduction` | 1 | `stoneProductionBonus` | `economyExtended.ts:355,360` | **CORRECTO** |
| 7 | `ironProduction` | 1 | `ironProductionBonus` | `economyExtended.ts:356,360` | **CORRECTO** |
| 8 | `goldProduction` | 9 | `goldProductionBonus` | `economyExtended.ts:346,359,371` | **CORRECTO** (aplica a minas de oro y a recaudación fiscal) |
| 9 | `constructionDuration` | 5 | `constructionDuration` | `buildings.ts:87,155` | **CORRECTO** (nota: el multiplicador combinado con obreros/Romanos no respeta el `0.5` muerto de `RESEARCH.CONSTRUCTION_MIN_DURATION_RATIO`). |
| 10 | `constructionCost` | 5 | `constructionCost` | `buildings.ts:113,158` → `buildingRules.ts:94` | **INCOMPLETO**: `buildingRules.ts:94` hardcodea `Math.max(0.75, ...)` sin referenciar `TECH_EFFECT_CAPS.constructionCost`, y el tope `0.25` desperdicia 6 pp de `construction_8`. |
| 11 | `researchDuration` | 8 | `researchDuration` | `technologies.ts:77,92`, `technologyRules.ts:326` | **INCOMPLETO**: discrepancia de redondeo (`ceil(s*m)` vs `ceil(s*1000*m)`) y saturación prematura del tope `0.40` (anula 8 pp generales y 3 exclusivas de civ). |
| 12 | `housingCapacity` | **0** | `housingCapacityBonus` | `buildings.ts:96`, `economy.ts:237` → `buildingRules.ts:168`, `UniversityPanel.tsx:158` | **AUSENTE en catálogo**: toda la infraestructura existe pero **ninguna tecnología otorga este efecto**. |
| 13 | `happinessBase` | 8 | `happinessBase` | `economyExtended.ts:485,495` | **CORRECTO** |
| 14 | `taxTolerance` | 1 | `taxToleranceReduction` | `economyExtended.ts:165-181,322,492,510` | **CORRECTO** |
| 15 | `trainingDuration` | 4 | `trainingDuration` | `army.ts:272,424` → `armyRules.ts:123` | **CORRECTO** |
| 16 | `woundedRecovery` | 3 | `woundedRecoveryBonus` | `economy.ts:332` → `battleRules.ts:616-626` | **CORRECTO** |
| 17 | `unlockWeaponSteel` | 1 | `unlockedWeapons` (`"acero"`) | `army.ts:302,533` → `armyRules.ts:460` | **CORRECTO** (nota de diseño: investigar exige Herrería 3, equipar exige Herrería 4). |
| 18 | `unlockArmorSteel` | 1 | `unlockedArmors` (`"acero"`) | `army.ts:303,534` → `armyRules.ts:469` | **CORRECTO** (ídem: investigar Herrería 3, equipar Herrería 4). |
| 19 | `unlockWeaponAdvancedSteel` | 1 | `unlockedWeapons` (`"aceroAvanzado"`) | `army.ts:302,533` → `armyRules.ts:460` | **CORRECTO** |
| 20 | `combatAttack` | 8 | `combatAttackBonus` | `army.ts:1404,1430`, `parliament.ts:470` → `battleRules.ts:230` | **CORRECTO** |
| 21 | `combatDefense` | 7 | `combatDefenseBonus` | `army.ts:1405,1431`, `parliament.ts:471` → `battleRules.ts:231` | **CORRECTO** |
| 22 | `marchSpeed` | 6 | `marchSpeedBonus` | `parliament.ts:286`, `territoryRules.ts:2655,2812` | **INCORRECTO**: **`army.ts:1185` (`launchAttack`) NO pasa `techModifiers.marchSpeedBonus`** a `marchTimeSeconds`. Todas las marchas reales en el mapa ignoran `logistics_2`, `logistics_5`, `spy_2`, `tech_civ_mongoles`, `tech_civ_mongoles_b` y `tech_civ_navajos_c`. Además, el +10 % de exploración de `spy_2` está hardcodeado por ID (`territories.ts:590,1092,2359`) fuera de `TechnologyModifiers`. |
| 23 | `marchFatigue` | 4 | `marchFatigueReduction` | `army.ts:1259`, `parliament.ts:467` → `territoryRules.ts:2670` | **CORRECTO** (aunque signo inconsistente en `balanceConfig.ts`). |
| 24 | `fatigueAccrual` | 2 | `fatigueAccrualReduction` | `army.ts:1260` → `territoryRules.ts:2671` | **INCOMPLETO**: `army.ts:1260` lo pasa correctamente, pero **`parliament.ts:467` (`snapshotSide`) omite el 6.º parámetro `techModifiers.fatigueAccrualReduction`**. |
| 25 | `moraleBase` | 7 | `moraleBase` | `army.ts:1406,1432`, `parliament.ts:472` → `battleRules.ts:241` | **INCOMPLETO**: suma en combate (`simulateBattle`), pero **no se incorpora a `economyExtended.ts:computeMorale`**, por lo que `kingdom.militaryMorale` y el panel general no muestran el bono. |
| 26–29 | `unitEfficiencyInf/Arc/Cav/All` | 9 / 5 / 4 / 2 | `unitEfficiency{Inf,Arc,Cav}` | `army.ts:1407-1409,1433-1435`, `parliament.ts:473-475` → `battleRules.ts:168-174` | **CORRECTO** *(nota: solo aplica a tipos base `infanteria`, `arqueria`, `caballeria`; no afecta a unidades de asedio, coherente con su definición).* |
| 30 | `mercenaryCost` | 2 | `mercenaryCostReduction` | `army.ts:584` → `armyRules.ts:558` | **CORRECTO** |
| 31 | `woundedRate` | 3 | `woundedRateBonus` | `army.ts:1410,1436`, `parliament.ts:476` → `battleRules.ts:297-302` | **CORRECTO** |
| 32 | `espionageAccuracy` | 5 | `espionageLevel` | `parliament.ts:342-374`, `bots.ts:68-74,143-150` | **INCOMPLETO**: funciona niveles 1–4 en `parliament.ts`, pero **`bots.ts:72-74,149-150` recorta al máximo nivel 2** (`espionage_3`, `espionage_4` y `tech_civ_navajos_a` no mejoran el espionaje contra bots ni ajustan su coste). |
| 33 | `counterEspionage` | 3 | `counterEspionage` | `parliament.ts:366-372` | **CORRECTO** (en PvP del Parlamento; bots no espían al jugador). |

---

## 8. Auditoría de Aislamiento por Civilización

1. **Identificación y normalización (`civilizationRules.ts:51-62`, `economy.ts:178-182,550-558`)**:
   - `kingdoms.civilization` es opcional en esquema (`v.optional(v.string())`), asignable al fundar (`getOrInitializeKingdom`) e inmutable una vez establecida (`CIVILIZATION_IMMUTABLE = true`, línea 551 bloquea cambios con `ConvexError`).
   - `normalizeCivilizationId` traduce alias legacy (`indiosAmericanos` / `indios_americanos` / `navajo` → `navajos`; `keniatas` → `masais`; `vikingo` → `vikingos`). `settleRelationalKingdomEconomy` migra perezosamente el reino en DB.
2. **Filtrado de catálogo en consulta (`technologies.ts:78-82`)**:
   - `getTechnologies` filtra el array devuelto en `catalog`: si `technology.branch !== "civilizacion"` lo incluye; si es `"civilizacion"`, exige `!technology.civilizationRequirement || normalizeCivilizationId(technology.civilizationRequirement) === normalizeCivilizationId(kingdom.civilization)`.
   - Un reino sin civilización (`undefined`/`null`) no ve ninguna de las 48 tecnologías de civilización (porque `normalizeCivilizationId(undefined)` es `null !== civ`).
   - **Dependencia implícita**: si una tecnología exclusiva futura se registrara con otra rama (p. ej. `branch: "militar"` y `civilizationRequirement: "romanos"`), aparecería en `getTechnologies` de otras civilizaciones (aunque marcada como `locked` por `evaluateTechnologyStatus`).
3. **Protección contra manipulación de peticiones (`researchTechnology` → `createResearchPlan`)**:
   - `createResearchPlan` (`technologyRules.ts:298-304`) ejecuta `evaluateTechnologyStatus`, que invoca `validateCivilizationTechAccess(technology.civilizationRequirement, kingdomCivilization)` (`civilizationRules.ts:79-99`).
   - Si un cliente fuerza el envío de `techType: "tech_civ_romanos"` desde un reino `griegos` o sin civilización, la mutación falla con `ConvexError("Bloqueada: Tecnología exclusiva de los Romanos...")`.
4. **Fuga o desincronización de IDs heredados (`LEGACY_TECHNOLOGY_IDS`)**:
   - `computeTechnologyModifiers`, `getTechnology`, `readCompletedTechnologyIds` (`technologyRules.ts:32-37,131,369`) y `compensation.ts:313` **sí normalizan** mediante `normalizeTechnologyId`.
   - **Defecto encontrado**: `getTechnologies` (`technologies.ts:52-54`), `createResearchPlan` (`technologyRules.ts:287-288`) y `missions.ts:94` **NO normalizan** `doc.technologyId` antes de meterlo en `completedIds` o `researchingIds`. Un documento antiguo con `technologyId: "tech_civ_indiosAmericanos"` o `"tech_civ_keniatas"` seguirá otorgando el modificador pasivo en `computeTechnologyModifiers`, **pero**:
     - Aparecerá en el catálogo UI de Navajos/Masáis como `available`/`locked` (sin marcar como `completed`), permitiendo volver a investigarlo.
     - Bloqueará `tech_civ_navajos_a/_b` y `tech_civ_masais_a/_b` por faltar el prerrequisito normalizado.
     - No completará la misión secreta de civilización en `missions.ts` (`missionRules.ts` también compara `mission.civilization !== snapshot.civilization` sin `normalizeCivilizationId` en líneas `208, 278` y `missions.ts:299`).
5. **Reino de demostración (`"guest_g9ai8cz"`) y fugas de lectura (`kingdoms.ts`)**:
   - `getTechnologies` (`technologies.ts:42-45,59`) y `kingdoms:getKingdomFull` (`kingdoms.ts:23-26,78-81,101`) permiten lectura pública únicamente del reino demo (`guest_g9ai8cz`), devolviendo `writable: false` en `getTechnologies` y exigiendo propiedad estricta en todas las mutaciones (`requireOwner`).
   - `getKingdomFull` devuelve los documentos brutos de `technologyProgress` solo para el propietario autenticado o para el demo público (`by_kingdom`), sin filtrar civilización porque los registros pertenecen al propio `kingdomId`. No expone tecnologías de otros jugadores.
6. **Reinicio de reino (`economy.ts:resetKingdom`, líneas 1291-1364)**:
   - Borra `technologyProgress` y limpia `kingdom.civilization = undefined`, permitiendo elegir otra civilización tras reiniciar.
   - **Observación**: `resetKingdom` NO borra `missionProgress` ni `missionCounters`; si el jugador completó la misión secreta `sec_<civAnterior>` antes de reiniciar, ese registro histórico permanece en `missionProgress`.

---

## 9. Seguridad, Persistencia en Convex, Concurrencia e Idempotencia

1. **Esquema e índices (`convex/schema.ts:181-197,430-431`)**:
   - Tabla `technologyProgress`: `kingdomId` (`v.id("kingdoms")`), `technologyId` (`v.string()`), `status` (`"researching" | "completed"`), `startedAt`, `durationMs`, `completedAt`, `costs`.
   - Índices: `.index("by_kingdom", ["kingdomId"])` y `.index("by_kingdom_and_technology", ["kingdomId", "technologyId"])`. (El índice compuesto está declarado en el esquema pero no se usa en las consultas actuales, que siempre leen todo el reino vía `by_kingdom`).
   - **Debilidad de esquema**: `schemaValidation: false` y `strictTableNameTypes: false` están activados globalmente en `schema.ts:430-431` (por compatibilidad con datos heredados), relajando la validación estricta de tipos en inserciones directas de Convex.
2. **Autorización y propiedad**:
   - `researchTechnology` y `cancelResearch` llaman `requireOwner(ctx, args.kingdomId)` (`buildings.ts`), verificando identidad autenticada e `isKingdomOwner`.
   - `cancelResearch` valida además `doc.kingdomId === args.kingdomId` y `doc.status === "researching"` (`technologies.ts:168-169`).
   - `completeResearch` es `internalMutation`, inaccesible directamente desde el cliente público.
3. **Concurrencia, atomicidad e idempotencia**:
   - **OCC de Convex**: tanto `researchTechnology` como `completeDueResearch` y `finalizeResearch` leen el rango completo de `technologyProgress` del reino (`withIndex("by_kingdom")`), por lo que dos mutaciones concurrentes del mismo reino que intenten iniciar la misma tecnología o exceder ranuras colisionan por control de concurrencia optimista (OCC) y la segunda se reintenta/rechaza con estado actualizado.
   - **Idempotencia ante doble ejecución (`scheduler` + `completeDueResearch`)**: `finalizeResearch` (`technologies.ts:184-198`) comprueba `doc.status === "researching"`, `progress === 100`, y busca documentos hermanos con mismo `technologyId` y `status === "completed"`, eliminando duplicados en lugar de mantener dos filas completadas. Asimismo `computeTechnologyModifiers` deduplica por `Set`.
   - **Salvaguarda de vencimiento**: `settleRelationalKingdomEconomy` (`economy.ts:175`) invoca `completeDueResearch(ctx, kingdom._id, now)` al inicio de casi todas las mutaciones económicas, militares, de construcción y de investigación, asegurando que ninguna investigación vencida bloquee ranuras o deje de aplicar sus bonos si un job del scheduler se retrasó.
   - **Nota sobre `completeDueResearch` y misiones**: `completeDueResearch` llama `finalizeResearch(ctx, doc, now, false)` (`evaluateMissionsNow = false`), confiando en que `settleRelationalKingdomEconomy` llama después a `evaluateKingdomMissions(ctx, kingdom._id, now)` en la línea 368 (siempre que no sea primera inicialización). En cambio `completeResearch` (`internalMutation`) sí evalúa misiones directamente (`evaluateMissionsNow = true`).

---

## 10. Capacidad de Expansión del Árbol Tecnológico

1. **Base de datos y esquema**:
   - `technologyProgress` almacena filas por `(kingdomId, technologyId)` sin límite fijo de columnas ni arrays embebidos en `kingdoms`. Admite **cientos o miles de tecnologías nuevas** sin cambios de esquema (`schema.ts:181-197`), y la consulta `by_kingdom` escala linealmente por reino.
2. **Límite de ranuras paralelas y tiempos**:
   - `RESEARCH.MAX_SLOTS = 3` (y tabla `RESEARCH_SLOTS_BY_UNIVERSITY` hasta nivel 5 de Universidad). Con un árbol actual de 91 tecnologías por reino (~11h 28m base + 38m base de civ = ~12h 06m secuenciales, ~4h con 3 ranuras llenas), duplicar o triplicar el árbol hacia 200–300 nodos sigue siendo viable, aunque requerirá revisar si la Universidad nivel 6–10 debería otorgar una 4.ª ranura o si `MAX_SLOTS` se mantiene en 3.
3. **Techo de edificios y progresión de requisitos**:
   - `CONSTRUCTION.MAX_LEVEL = 200` (`balanceConfig.ts:203`), mientras que el árbol actual solo exige hasta **Castillo nivel 8**, **Universidad nivel 5** y edificios productivos/militares hasta **nivel 6–7**. Existe un enorme margen de progresión (niveles de edificio 9–200) disponible para nuevas ramas de eras avanzadas sin tocar límites arquitectónicos.
4. **Saturación de `TECH_EFFECT_CAPS` (principal cuello de botella actual)**:
   - Como se demostró en la Sección 5, `constructionCost` (`0.25`) y `researchDuration` (`0.40`) **ya están sobre-saturados**, `espionageAccuracy` (`4`) satura con `espionage_4`, y `moraleBase` (`15`) / `unitEfficiencyInf` (`0.30`) llegan al 100 % del tope con Masáis y Romanos respectivamente.
   - Añadir nuevas tecnologías con esas mismas claves **no tendrá ningún efecto en el jugador** salvo que se suban los valores de `TECH_EFFECT_CAPS` o se utilicen claves infrautilizadas (como `housingCapacity`, `wood/stone/ironProduction`, `fatigueAccrual`, `miningProduction`, `woundedRecovery`, `storageCapacity`) o se añadan nuevos efectos en el motor.
5. **Interfaz de usuario (`src/components/UniversityPanel.tsx`)**:
   - Renderiza una rejilla plana (`grid-cols-1 md:grid-cols-2`) agrupada únicamente por las 5 claves de `BRANCH_LABELS` (`economica`, `civil`, `militar`, `inteligencia`, `civilizacion`), sin árbol visual/grafo, sin filtros por estado (`disponibles` / `investigadas` / `bloqueadas`), sin paginación ni colapsado por rama.
   - Con ~91 tarjetas en una sola vista, el scroll ya es considerable; ampliar a >150–200 tecnologías por reino degradará la usabilidad si no se añaden filtros, buscador o agrupación por subramas/tiers.
   - Además, el panel aún usa `window.confirm` (`UniversityPanel.tsx:129`), práctica desaconsejada en entorno iFrame.
6. **Esfuerzo de ampliación (Solo configuración vs. Cambios de código)**:
   - **Solo configuración (`balanceConfig.ts`)**: añadir nuevos nodos con cualquiera de los 32 `TechnologyEffectKey` ya implementados (incluidos los 12 meses/tiers futuros, edificios hasta nivel 200 o subcadenas de civilización adicionales), siempre que no superen `TECH_EFFECT_CAPS`.
   - **Requiere cambios de código**:
     1. Activar/ajustar topes en `TECH_EFFECT_CAPS` o corregir los fallos de consumo existentes (`launchAttack` para `marchSpeedBonus`, `bots.ts` para espionaje nv 3–4, `economy.ts` proyecciones, etc.).
     2. Implementar nuevos `TechnologyEffectKey` (por ejemplo los diferidos `formationEfficiency` y `equipmentWear` mencionados en `balanceConfig.ts:1134`, reducción de costes de entrenamiento/mantenimiento, comercio, diplomacia, etc.) en `technologyRules.ts` y en los motores correspondientes.
     3. Mejorar `UniversityPanel.tsx` (filtros/vista de árbol) si se supera ~120 tecnologías visibles por reino.

---

## 11. Hallazgos Clasificados

Se clasifican los hallazgos exclusivamente con las categorías solicitadas (`CORRECTO`, `INCOMPLETO`, `INCORRECTO`, `AUSENTE`, `NO VERIFICABLE`).

| Clasificación | Archivo · Símbolo · Línea | Descripción y Evidencia | Consecuencia en Juego |
| --- | --- | --- | --- |
| **INCORRECTO** | `convex/army.ts` · `launchAttack` · `L1185` | Llama a `marchTimeSeconds(distance, terrainMul, unitMul, civPassive?.marchSpeedMultiplier ?? 1.0)` omitiendo el 5.º parámetro `techSpeedBonus`. No lee `readCompletedTechnologyIds` al lanzar la marcha. | Las 6 tecnologías de `marchSpeed` (`logistics_2`, `logistics_5`, `spy_2`, `tech_civ_mongoles`, `tech_civ_mongoles_b`, `tech_civ_navajos_c`) **no aceleran ninguna marcha real en el mapa** (solo funcionan en `parliament.ts:acceptChallenge`). |
| **INCORRECTO** | `convex/economy.ts` · `getKingdom`, `getSimulatedKingdomResources` · `L1015-1024, L1103-1114`; `convex/economyAdapter.ts` · `L636` | Ambas queries de solo lectura llaman `simulateEconomicProgress(adapterResult.kingdomState, targetTime)` sin pasar `foodProductionMultiplier` ni `foodConsumptionMultiplier` (quedan en `1`). | Las proyecciones en vivo entre mutaciones ignoran `agricultureProduction`, `foodConsumption`, terreno, panadería, productividad fiscal y pasiva agrícola hasta que una mutación ejecuta `settleRelationalKingdomEconomy`. |
| **INCOMPLETO** | `convex/technologies.ts` · `getTechnologies` · `L52-54`; `convex/technologyRules.ts` · `createResearchPlan` · `L287-288`; `convex/missions.ts` · `buildSnapshot` · `L94` | No aplican `normalizeTechnologyId(doc.technologyId)` al construir `completedIds`/`researchingIds`, a diferencia de `computeTechnologyModifiers` (`L131`) y `readCompletedTechnologyIds` (`L369`). | Reinos con registros históricos (`tech_civ_indiosAmericanos` / `tech_civ_keniatas`) reciben el bono en cálculos pero ven la tecnología como investigable otra vez, tienen bloqueadas `_a`/`_b` y no completan su misión secreta. |
| **INCOMPLETO** | `convex/balanceConfig.ts` · `TECH_EFFECT_CAPS` · `L959-960, L1008, L1014, L1094, L1105, L1114` | `constructionCost` suma `-0.31` vs tope `0.25` (6 pp perdidos); `researchDuration` suma `-0.48` general vs tope `0.40` (8 pp perdidos) más `-0.05/-0.06` de Griegos, Árabes y Chinos. `espionage_4` (4) + `tech_civ_navajos_a` (+1) chocan con `espionageAccuracyMax = 4`. | Tecnologías de nivel 5 caras (`construction_8`, `educ_6`) y exclusivas de civilización (`tech_civ_griegos_b`, `tech_civ_arabes_a`, `tech_civ_chinos_a`, `tech_civ_navajos_a`) quedan total o parcialmente anuladas en endgame. |
| **INCOMPLETO** | `convex/bots.ts` · `listBots`, `requestBotEspionage` · `L70-74, L149-150` | Fija `const level = playerEspionageLevel >= 2 ? 2 : 1` y solo consulta `costByLevel[1]` / `costByLevel[2]`. | Investigar `espionage_3`, `espionage_4` o `tech_civ_navajos_a` (niveles 3 y 4) no aporta precisión adicional ni coste acorde contra bots del Parlamento. |
| **INCOMPLETO** | `convex/parliament.ts` · `snapshotSide`, `acceptChallenge` · `L284, L467` | `snapshotSide` (`L467`) omite `techModifiers.fatigueAccrualReduction` al llamar `marchFatigue(...)` (sí presente en `army.ts:1260`). `acceptChallenge` (`L284`) llama `armyMarchMultiplier` sin `attackerKingdom?.civilization`. | En batallas parlamentarias, `medical_4` y `logistics_3` no reducen la fatiga previa, y los Aztecas reciben velocidad reducida si usan caballería en lugar de tratarse como infantería. |
| **INCOMPLETO** | `convex/economyExtended.ts` · `computeMorale` · `L190-213` | `techModifiers.moraleBase` se aplica únicamente a `BattleSide.moraleBase` en `battleRules.ts:241`, pero no entra en `computeMorale` ni en `settleRelationalKingdomEconomy`. | El jugador con tecnologías de moral (`happiness_3`, `training_4`, `logistics_4`, etc.) ve en su ficha general `militaryMorale` sin reflejar dicho bono hasta entrar en combate. |
| **INCOMPLETO** | `convex/missions.ts` · `grantReward`, `claimMissionReward`, `getMissions` · `L120, L267, L299`; `convex/missionRules.ts` · `L208, L278` | Usa `storageCapacity(market)` sin `techModifiers.storageCapacity` ni `civ.storageCapacityMultiplier`, y compara `mission.civilization !== civilization` sin `normalizeCivilizationId`. | Jugadores cuyo almacén cabe gracias a `storage_1..3` / `trade_1` / Vikingos reciben bloqueo falso `"NO HAY SITIO EN EL MERCADO"` al cobrar misiones; reinos con civ sin normalizar pierden su misión secreta. |
| **INCOMPLETO** | `convex/technologies.ts` · `getTechnologies` · `L92` vs `convex/technologyRules.ts` · `createResearchPlan` · `L326` | `Math.ceil(baseSec * m)` vs `Math.ceil(baseSec * 1000 * m)` (con deriva IEEE-754 en `0.54`). | Diferencia de hasta 1 segundo entre la duración mostrada en `UniversityPanel` y la duración real programada en el servidor. |
| **INCOMPLETO** | `convex/territories.ts` · `L590, L1092, L2359`; `convex/explorationRules.ts` · `L151-154` | El bono `-10 %` de duración de exploración de `spy_2` está acoplado por ID fijo (`completedTech.includes("spy_2")`) fuera de `TechnologyModifiers`. | Impide otorgar bonos de exploración mediante `TECHNOLOGIES` con efecto tipado; requiere editar código para futuras tecnologías de exploración. |
| **INCOMPLETO** | `convex/buildingRules.ts` · `costsForTargetLevel` · `L94`; `convex/buildings.ts` · `L86-89, L154-157` | Hardcodea `Math.max(0.75, ...)` en lugar de `TECH_EFFECT_CAPS.constructionCost`, y el producto de duración `0.60 × 0.80 × 0.90 = 0.432` baja de `RESEARCH.CONSTRUCTION_MIN_DURATION_RATIO` (`0.5`, sin uso en código). | Constante `RESEARCH.CONSTRUCTION_MIN_DURATION_RATIO` muerta y piso documental `0.50` violado por combinación con trabajadores y Romanos. |
| **AUSENTE** | `convex/balanceConfig.ts` · `TECHNOLOGIES` · `L973-1133` | No existe ninguna tecnología con `effect.key === "housingCapacity"`, aunque la clave, el tope (`0.30`), el campo `housingCapacityBonus`, el cálculo en `buildingRules.ts:168` y el texto en `UniversityPanel.tsx:158` están implementados. | Una de las 33 `TechnologyEffectKey` declaradas es código muerto de catálogo hasta que se añadan tecnologías de vivienda/urbanismo. |
| **AUSENTE** | `convex/balanceConfig.ts` · `L1134` | Tecnologías y efectos planeados `form_1-7`, `forge_1`, `forge_6` (`formationEfficiency`, `equipmentWear`) están aplazados y no existen en el motor. | Funcionalidad táctica de desgaste/eficacia de formación pendiente de diseño e implementación futura. |
| **CORRECTO** | `convex/technologyRules.ts` · `evaluateTechnologyStatus`, `createResearchPlan`; `convex/civilizationRules.ts` · `validateCivilizationTechAccess` | Validación autoritativa de civilización en backend (`ConvexError`), ranuras por Universidad (`0/1/2/3`), costes, deduplicación en `finalizeResearch` (`technologies.ts:189-194`) y concurrencia OCC. | Imposible investigar tecnologías de otra civilización manipulando llamadas al servidor o duplicar efectos completados. |
| **CORRECTO** | `convex/economy.ts`, `convex/army.ts`, `convex/battleRules.ts` | Aplicación en runtime de `miningProduction`, `wood/stone/iron/goldProduction`, `happinessBase`, `taxTolerance`, `trainingDuration`, `woundedRecovery`, `woundedRate`, `combatAttack`, `combatDefense`, `unitEfficiency*`, `mercenaryCost`, `counterEspionage` y desbloqueos de equipo. | Efectos económicos y militares principales operativos según fórmulas documentadas. |
| **NO VERIFICABLE** | `convex/schema.ts` · `L430-431` (`schemaValidation: false`) | Estado histórico real de documentos ya persistidos en despliegues remotos de Convex (ej. posibles filas antiguas con `tech_civ_indiosAmericanos` o `tech_civ_keniatas`). | Sin acceso a la base de datos de producción remota no puede cuantificarse cuántos reinos tienen IDs legacy pendientes de normalizar. |

---

## 12. Recomendaciones Concretas Previas a la Ampliación del Árbol

### Prioridad Alta (Correcciones de integridad antes de añadir nodos)
1. **Conectar `marchSpeedBonus` en `convex/army.ts:1185`**: leer `computeTechnologyModifiers(await readCompletedTechnologyIds(ctx, args.kingdomId)).marchSpeedBonus` dentro de `launchAttack` y pasarlo como 5.º argumento a `marchTimeSeconds`.
2. **Normalizar IDs legacy en los 3 lectores faltantes**: aplicar `normalizeTechnologyId` en `technologies.ts:52-54` (`getTechnologies`), `technologyRules.ts:287-288` (`createResearchPlan`) y `missions.ts:94` (`buildSnapshot`), además de `normalizeCivilizationId` en `missionRules.ts:208,278` y `missions.ts:299`.
3. **Unificar `parliament.ts` y `bots.ts`**:
   - Pasar `techModifiers.fatigueAccrualReduction` en `parliament.ts:467` (`snapshotSide`) y `attackerKingdom?.civilization` en `parliament.ts:284` (`armyMarchMultiplier`).
   - Habilitar niveles 3 y 4 en `bots.ts:70-74,149-150` usando `PARLIAMENT.ESPIONAGE.costByLevel[Math.min(4, playerEspionageLevel)]`.
4. **Corregir proyecciones económicas y almacenamiento de misiones**:
   - Pasar multiplicadores reales o delegar la proyección de `economy:getKingdom` y `economy:getSimulatedKingdomResources` considerando tecnología, terreno, panadería y civilización.
   - Pasar `techModifiers.storageCapacity * (civPassive.storageCapacityMultiplier ?? 1)` en `missions.ts:120,267`.

### Prioridad Media (Rebalanceo de topes y consistencia matemática)
5. **Desbloquear o recalibrar los topes saturados en `TECH_EFFECT_CAPS`**:
   - Subir `researchDuration` (por ejemplo de `0.40` a `0.55`, o reducir valores de `educ_1..4`/`educ_6`) para que `educ_6` y las exclusivas de Griegos/Árabes/Chinos tengan valor real.
   - Subir `constructionCost` (de `0.25` a `0.35`, alineando `buildingRules.ts:94` para que lea `1 - TECH_EFFECT_CAPS.constructionCost`) para que `construction_8` no se desperdicie.
   - Revisar `tech_civ_navajos_a` frente a `espionageAccuracyMax = 4` (por ejemplo elevar el tope a 5 o sustituir por un bono de coste/sigilo de espías si ya existe nivel 4).
6. **Aprovechar claves y limpiar deuda de diseño**:
   - Introducir tecnologías reales de **`housingCapacity`** (capacidad residencial) en la rama `civil` para aprovechar el efecto ya implementado en motor e interfaz.
   - Promover el bono de exploración de `spy_2` a un `TechnologyEffectKey` propio (`explorationDuration`) dentro de `TechnologyModifiers`.
   - Unificar la fórmula de redondeo entre `getTechnologies` y `createResearchPlan` (calculando `Math.ceil(Math.round(base * 1000 * m))` o redondeando a segundos enteros en ambos lados) y reflejar `moraleBase` en el resumen/moral del reino o documentar explícitamente su ámbito exclusivo de batalla.
   - Unificar signos en `balanceConfig.ts` (`marchFatigue` todo negativo como el resto de reducciones) y renombrar/ordenar la secuencia `medicine_*` / `medical_*` al añadir nuevos tiers (manteniendo alias en `LEGACY_TECHNOLOGY_IDS` si se renombraran IDs).

### Prioridad Baja (Preparación para un árbol tecnológico de gran escala)
7. **Escalado de interfaz en `UniversityPanel.tsx`**: incorporar pestañas/filtros por estado (`disponibles`, `bloqueadas`, `investigadas`), vista jerárquica por dependencias dentro de cada rama, y reemplazar `window.confirm` por confirmación modal integrada.
8. **Soporte multi-era**: si la ampliación supera las 180–250 tecnologías totales, valorar ampliar `RESEARCH_SLOTS_BY_UNIVERSITY` (ej. Universidad nivel 8 → 4 ranuras) e introducir requisitos de Castillo 9–20+ para evitar cuellos de botella temporales en juego tardío.
