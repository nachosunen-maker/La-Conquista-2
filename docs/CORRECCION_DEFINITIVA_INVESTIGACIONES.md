# INFORME DE IMPLEMENTACIÓN CORRECTIVA DEFINITIVA — SISTEMA DE INVESTIGACIONES

**Proyecto**: La Conquista  
**Repositorio**: `nachosunen-maker/La-Conquista-2`  
**Rama**: `main`  
**Commit base**: `e8ca2b625ef8024d92722f9ce09111ad082659f2` (`test(compensation): await claim mutation in test 34 and sync lockfile`)  
**Fecha de validación**: 23 de noviembre de 2026  
**Estado final**: **TODOS LOS DEFECTOS CORREGIDOS Y VALIDADOS (CIERRE DEFINITIVO)**  

---

## 1. RESUMEN EJECUTIVO Y CRITERIO DE CIERRE

En estricta conformidad con las directrices de la especificación técnica correctiva y los hallazgos de `docs/AUDITORIA_COMPLETA_INVESTIGACIONES_Y_PROGRESION_MATEMATICA.md`:

1. **Total de tecnologías**: Se mantiene exactamente en **135 tecnologías** existentes (32 iniciales + 16 E1 + 12 E2 + 12 E3 + 13 E4a + 2 E4b + 7 E4c + 5 E5 + 18 E6a + 18 E6b). **No se ha añadido, eliminado, sustituido ni renombrado arbitrariamente ninguna investigación** (0 investigaciones nuevas; `housingCapacity` permanece con 0 nodos en el catálogo con infraestructura lista).
2. **Aislamiento por civilización**: Se ha implementado un control de acceso estricto basado en `civilizationRequirement` (independiente del nombre o tipo de rama tecnológica). Cada una de las 12 civilizaciones accede exactamente a 87 investigaciones generales + 4 exclusivas propias = 91 visibles; ningún reino puede ver, consultar metadatos ni iniciar tecnologías de otra civilización.
3. **Persistencia y backend autoritativo**: Todos los cálculos de efectos, duraciones, costes, almacenamiento y velocidades se calculan exclusivamente en el backend sobre los datos reales del reino sin confiar en parámetros enviados por el cliente.
4. **Validación en una sola ejecución**: Se han ejecutado los 6 comandos preceptivos de validación en el orden prescrito, registrando un **100 % de éxito (código de salida 0)** en cada uno.

---

## 2. DEFECTOS CONFIRMADOS Y SOLUCIONES APLICADAS

### §2.1. Velocidad de marcha: aplicación en desplazamientos reales (`launchAttack`)
- **Defecto**: En `convex/army.ts:1185`, la mutación `launchAttack` no pasaba `techModifiers.marchSpeedBonus` al calcular `marchTimeSeconds`, anulando en combate real los efectos de `logistics_2`, `logistics_5`, `spy_2` y las exclusivas `tech_civ_mongoles`, `tech_civ_mongoles_b`, `tech_civ_navajos_c`.
- **Solución**: En `convex/army.ts`, se recuperan los modificadores tecnológicos consolidados del reino atacante (`attackerTech = computeTechnologyModifiers(completedIds)`) y se transmiten explícitamente a `marchTimeSeconds(distance, terrainDefense, unitSpeedMultiplier, armyMarchMultiplier(attackerKingdom.civilization), attackerTech.marchSpeedBonus)`.
- **Efecto verificado**: Las duraciones se reducen exactamente según el factor de velocidad:
  - Base (d=4, inf=1.0, rom=1.0): `7200 s`
  - Con `logistics_2` (+7 %): `6729 s` (fórmula `ceil(7200 / 1.07)`)
  - Con genéricos máx (`logistics_2` + `logistics_5` + `spy_2` = +20 %): `6000 s` (fórmula `ceil(7200 / 1.20)`)
  - Con mongoles (+15 % cultural, +45 % tecnológico = +66.75 % compuesto): `4318 s` (fórmula `ceil(7200 / (1.15 * 1.45))`)
  - Con navajos (`tech_civ_navajos_c` = +12 %): `6429 s` (fórmula `ceil(7200 / 1.12)`)

### §2.2. Proyecciones económicas: paridad matemática entre proyección y liquidación
- **Defecto**: En `convex/economy.ts:1015,1103` y `convex/economyAdapter.ts:636`, las consultas `getKingdom` y `getSimulatedKingdomResources` proyectaban la economía utilizando únicamente la simulación base de comida sin los modificadores de madera, piedra, hierro, oro, almacenamiento ni moral militar base de tecnologías investigadas.
- **Solución**: Se extendió `calculateSimulatedKingdomResources` con el parámetro opcional `extendedProjection`, el cual calcula o recibe `buildingLevels`, `technologyModifiers`, `residentialCapacity` y `jobCapacities`, invocando `simulateExtendedEconomy`. En `convex/economy.ts`, `getKingdom` y `getSimulatedKingdomResources` obtienen las tecnologías completadas, niveles de edificios y bonificaciones de terreno del reino, entregando proyecciones idénticas a la liquidación transaccional `settleKingdomEconomy`.

### §2.3. Capacidad de almacenamiento efectiva en cobro de recompensas y compensaciones
- **Defecto**: En `convex/missions.ts:120,267` y `convex/compensation.ts:98`, `claimMissionReward` y `grantReward` llamaban a `storageCapacity(marketLevel)` sin incorporar el multiplicador tecnológico `storageCapacity` ni el multiplicador cultural de civilización (p. ej. Vikingos ×1.10).
- **Solución**: Se centralizó la función canónica `effectiveKingdomStorageCapacity({ marketLevel, technologyMultiplier, civilization })` en `convex/economyExtended.ts`, y se adoptó en `missions.ts`, `compensation.ts`, `economyAdapter.ts` y `economy.ts`. Cada recurso se valida de forma atómica: la entrega es transaccional (o se entregan todos los recursos dentro de la capacidad efectiva o la operación falla sin modificar reservas).

### §2.4. Costes de construcción: coherencia matemática y eliminación de saturación
- **Defecto**: En `convex/buildingRules.ts:94`, existía una constante `0.75` codificada directamente, desacoplada de `TECH_EFFECT_CAPS.constructionCost = 0.25` (`floor = 0.75`). Además, la suma de las 5 tecnologías de construcción (`construction_4` a `construction_8`) sumaba 31 % de descuento, saturándose prematuramente en 25 % y dejando niveles muertos (sin beneficio marginal).
- **Solución**:
  1. Se exportó `MIN_CONSTRUCTION_COST_MULTIPLIER = 1 - TECH_EFFECT_CAPS.constructionCost` (0.75) y la función canónica `clampConstructionCostMultiplier(multiplier)` en `convex/buildingRules.ts`.
  2. Se reequilibraron los valores de las tecnologías en `convex/balanceConfig.ts`:
     - `construction_4`: `-6 %` (acumulado 0.94)
     - `construction_5`: `-5 %` (acumulado 0.89)
     - `construction_6`: `-5 %` (acumulado 0.84)
     - `construction_7`: `-5 %` (acumulado 0.79)
     - `construction_8`: `-4 %` (acumulado 0.75)
  3. Cada nivel aporta beneficio marginal comprobado y el total converge exactamente al tope de 25 % de reducción (`0.75` del coste base) sin ningún nivel desperdiciado.

### §2.5. Duración de investigaciones: unificación de unidades y estabilización IEEE-754
- **Defecto**: Discrepancias entre `ceil(seconds * mult)` y `ceil(seconds * 1000 * mult)` en `convex/technologies.ts:77,92` y `convex/technologyRules.ts:326`, desajustes por representación de coma flotante (p. ej. `0.90 * 0.60 = 0.5400000000000001`), y saturación prematura de `researchDuration` (acumulado 44 % frente a tope del 40 % / suelo 0.60).
- **Solución**:
  1. Se implementó la función canónica `computeResearchDuration(baseSeconds, techMultiplier, civMultiplier)` en `convex/technologyRules.ts`. La función opera en segundos con redondeo seguro de coma flotante (`round(eff * 1e9) / 1e9`), aplica `Math.ceil()`, y garantiza `durationMs === durationSeconds * 1000`.
  2. Se estabilizó `applyCivilizationResearchDuration` en `convex/civilizationRules.ts` con protección `1e-9`.
  3. Se reequilibraron las tecnologías de educación en `convex/balanceConfig.ts`:
     - `educ_1`: `-8 %` (0.92)
     - `educ_2`: `-7 %` (0.85)
     - `educ_3`: `-7 %` (0.78)
     - `educ_4`: `-6 %` (0.72)
     - `educ_6`: `-6 %` (0.66)
     - Tecnologías exclusivas de civilización (`tech_civ_griegos_b`, `tech_civ_chinos_a`, `tech_civ_arabes_a`) reducen de 0.66 a 0.61 y 0.60 (saturación exacta en el límite de seguridad `0.60`, sin desperdicio).
  4. Compatibilidad total con colas históricas: las marcas temporales `startedAt` y `durationMs` persistidas no se alteran retrospectivamente.

### §2.6. Bonificación de capacidad residencial (`housingCapacity`)
- **Confirmación**: El catálogo tiene exactamente 0 tecnologías que otorguen `housingCapacity` (diseño intacto). La infraestructura en `convex/technologyRules.ts`, `convex/buildingRules.ts` (`calculateResidentialCapacity`) y `convex/economyExtended.ts` está completamente integrada, conectada y validada con pruebas unitarias para cuando se amplíe el árbol tecnológico.

### §3.1. Fatiga en batallas del Parlamento
- **Defecto**: En `convex/parliament.ts:467`, `snapshotSide` omitía `techModifiers.fatigueAccrualReduction`. Además, `acceptChallenge` omitía la civilización del atacante al calcular el multiplicador de velocidad militar.
- **Solución**: Se incorporaron `techModifiers.fatigueAccrualReduction` y `techModifiers.marchFatigueReduction` en `parliament.ts`, igualando el cálculo de fatiga al motor de campaña general de `convex/territoryRules.ts:marchFatigue`.

### §3.2. Moral militar: consistencia entre combate y resumen del reino
- **Defecto**: `moraleBase` (otorgado por `happiness_3`) aumentaba la moral en el motor de combate pero no se computaba en `computeMorale` en `convex/economyExtended.ts`.
- **Solución**: `computeMorale` ahora recibe e incorpora `moraleBase` (con tope en `TECH_EFFECT_CAPS.moraleBase = 10`), garantizando que la moral militar mostrada en el panel del reino y las proyecciones refleje de forma idéntica la moral inicial aplicada en combate.

### §3.3. Espionaje contra bots: soporte completo para niveles 1 a 4
- **Defecto**: En `convex/bots.ts` y `convex/botRules.ts`, el espionaje contra bots clampeaba el nivel máximo a 2, ignorando `espionage_3` (nivel 3: ±3 % error), `espionage_4` (nivel 4: 0 % error / exacto) y la bonificación Navajo `tech_civ_navajos_a`.
- **Solución**: Se elevó el límite de `estimateBotArmy` a `TECH_EFFECT_CAPS.espionageAccuracyMax = 4`. Se actualizaron los costes de espionaje contra bots para los niveles 3 y 4 en `bots.ts`.

### §4. Normalización de identificadores históricos en todos los lectores
- **Defecto**: En `technologies.ts`, `technologyRules.ts`, `missions.ts` y `missionRules.ts`, consultas directas y comparaciones utilizaban identificadores crudos sin pasar por `normalizeTechnologyId` y `normalizeCivilizationId`, provocando que reinos con IDs históricos (p. ej. `tech_civ_indiosAmericanos`, `tech_civ_keniatas`, civilizaciones `indiosAmericanos`, `keniatas`) pudieran ver duplicadas sus tecnologías o bloqueadas sus sucesoras.
- **Solución**: Se aplicó la normalización idempotente centralizada en la construcción de conjuntos de tecnologías completadas, requisitos previos de catálogo, cálculo de modificadores y evaluación de progreso de misiones.

### §5. Aislamiento estricto de investigaciones por civilización
- **Defecto**: El filtrado dependía frágilmente de la rama `branch === "civilizacion"`.
- **Solución**: Se crearon las funciones `isTechnologyVisibleForCivilization`, `filterVisibleTechnologiesForCivilization` y `getVisibleTechnologyForCivilization` en `convex/technologyRules.ts`, comprobando directamente `civilizationRequirement`. Tanto las consultas de catálogo general (`getTechnologies`) como las consultas individuales y las mutaciones (`researchTechnology`, `cancelResearch`) verifican la civilización real del reino autenticado y rechazan cualquier intento de iniciar o inspeccionar tecnologías ajenas.

---

## 3. ARCHIVOS Y FUNCIONES MODIFICADOS

| Archivo | Funciones / Secciones modificadas | Propósito de la modificación |
|---|---|---|
| `convex/balanceConfig.ts` | `TECHNOLOGIES` (`construction_5..8`, `educ_2,3,4,6`) | Rebalanceo matemático para convergencia exacta a los topes de saturación (0.75 en construcción, 0.60 en duración de investigación) sin niveles muertos. |
| `convex/buildingRules.ts` | `MIN_CONSTRUCTION_COST_MULTIPLIER`, `clampConstructionCostMultiplier`, `costsForTargetLevel` | Centralización del límite de coste de construcción sobre `TECH_EFFECT_CAPS.constructionCost`. |
| `convex/civilizationRules.ts` | `applyCivilizationResearchDuration` | Estabilización numérica con tolerancia IEEE-754 (`1e-9`). |
| `convex/technologyRules.ts` | `computeResearchDuration`, `isTechnologyVisibleForCivilization`, `filterVisibleTechnologiesForCivilization`, `getVisibleTechnologyForCivilization`, `computeTechnologyModifiers`, `evaluateTechnologyStatus` | Función canónica de duración de investigaciones; aislamiento estricto por `civilizationRequirement`; normalización histórica de identificadores. |
| `convex/technologies.ts` | `getTechnologies`, `researchTechnology`, `finalizeResearch` | Aislamiento estricto por civilización autenticada en backend; aplicación de `computeResearchDuration`; normalización de colas y catálogo. |
| `convex/economyExtended.ts` | `computeMorale`, `effectiveKingdomStorageCapacity` | Incorporación de `moraleBase` al panel y proyección del reino; función unificada de capacidad de almacenamiento con tecnología y civilización. |
| `convex/economyAdapter.ts` | `calculateSimulatedKingdomResources`, `RemoteArmyUnitDoc` | Soporte para proyección económica ampliada (`extendedProjection`) que incluye los 5 recursos, almacenamiento y moral. |
| `convex/economy.ts` | `getKingdom`, `getSimulatedKingdomResources` | Conexión de tecnologías, edificios y terreno para alimentar la proyección ampliada con paridad matemática total con la liquidación. |
| `convex/compensation.ts` | `claimOutageCompensation` | Sustitución de cálculo de capacidad en línea por `effectiveKingdomStorageCapacity`. |
| `convex/army.ts` | `launchAttack`, `resolveBattleSideMorale` | Transmisión de `techModifiers.marchSpeedBonus` a `marchTimeSeconds`; aplicación canónica de moral militar. |
| `convex/parliament.ts` | `acceptChallenge`, `snapshotSide` | Transmisión de civilización atacante a `armyMarchMultiplier` y de `fatigueAccrualReduction` a `marchFatigue`. |
| `convex/botRules.ts` | `estimateBotArmy` | Elevación del tope de nivel de espionaje a 4 (niveles 3 ±3 % y 4 exacto). |
| `convex/bots.ts` | `executeSpyMission` | Costes y resolución de niveles 3 y 4 de espionaje contra bots. |
| `convex/missionRules.ts` | `conditionProgress` | Normalización histórica de IDs tecnológicos y de civilización al evaluar progreso de misiones. |
| `convex/missions.ts` | `claimMissionReward`, `grantReward`, `getAvailableMissions` | Aplicación de `effectiveKingdomStorageCapacity` y normalización de civilizaciones. |
| `src/components/ParliamentPanel.tsx` | Panel de espionaje del Parlamento | Fallback para banderas `hasEspionage3` y `hasEspionage4`. |
| `convex/technologyPureTests.ts` | Batería pura de pruebas | Incorporación y validación de las pruebas 30 a 36 (§2.1–§6). |
| `convex/researchFixes.test.ts` | Suite completa de integración `convex-test` | Batería de 10 pruebas de integración real sin mocks sobre base de datos relacional Convex. |

---

## 4. FÓRMULAS MATEMÁTICAS DEFINITIVAS, LÍMITES Y REDONDEOS

### 4.1. Velocidad y duración de marcha militar
$$\text{marchSpeedMultiplier} = \text{civSpeedMultiplier} \times (1 + \min(0.55, \text{tech.marchSpeedBonus}))$$
$$\text{duraciónSeconds} = \left\lceil \frac{1800 \times \text{distance}}{\text{terrainDefense} \times \text{unitSpeedMultiplier} \times \text{marchSpeedMultiplier}} \right\rceil$$

### 4.2. Costes de construcción de edificios
$$\text{effectiveDiscount} = \min(0.25, \text{sumTechDiscounts})$$
$$\text{multiplier} = \max(0.75, 1 - \text{effectiveDiscount})$$
$$\text{costeRecurso} = \text{round}(\text{baseCoste} \times 1.15^{\text{targetLevel} - 1} \times \text{multiplier})$$

### 4.3. Duración de investigaciones
$$\text{effMultiplier} = \max(0.60, 1 - \min(0.40, \text{tech.researchDurationBonus})) \times \text{civResearchMultiplier}$$
$$\text{effMultiplierRounded} = \frac{\text{round}(\text{effMultiplier} \times 10^9)}{10^9}$$
$$\text{durationSeconds} = \max(1, \lceil \text{baseSeconds} \times \text{effMultiplierRounded} \rceil)$$
$$\text{durationMs} = \text{durationSeconds} \times 1000$$

### 4.4. Capacidad efectiva de almacenamiento
$$\text{baseCapacity} = 10\,000 + 2\,000 \times \text{marketLevel}$$
$$\text{totalMultiplier} = \min(2.00, \text{tech.storageCapacityMultiplier}) \times \text{civStorageMultiplier}$$
$$\text{effectiveCapacity} = \lfloor \text{baseCapacity} \times \text{totalMultiplier} \rfloor$$

### 4.5. Moral militar del reino
$$\text{techBonus} = \min(10, \text{tech.moraleBase})$$
$$\text{morale} = \text{clamp}\left(50 + \text{techBonus} + 0.25 \times (\text{happiness} - 50) + \text{foodTierBonus} + \text{gloryBonus} - \text{taxPenalty} - \text{starvationPenalty},\ 0,\ 100\right)$$

### 4.6. Espionaje contra bots
- **Nivel 0** (Sin espionaje): Ratio de error $\pm 25\ \%$ ($[0.75 \times N, 1.25 \times N]$).
- **Nivel 1** (`espionage_1`): Ratio de error $\pm 15\ \%$ ($[0.85 \times N, 1.15 \times N]$).
- **Nivel 2** (`espionage_2`): Ratio de error $\pm 7\ \%$ ($[0.93 \times N, 1.07 \times N]$).
- **Nivel 3** (`espionage_3` o `espionage_2` + `tech_civ_navajos_a`): Ratio de error $\pm 3\ \%$ ($[0.97 \times N, 1.03 \times N]$).
- **Nivel 4** (`espionage_4` o `espionage_3` + `tech_civ_navajos_a`): Ratio de error $0\ \%$ (Conteo exacto $[N, N]$).

---

## 5. RESULTADOS DE LAS PRUEBAS DE AISLAMIENTO POR CIVILIZACIÓN (12/12)

Se ha ejecutado la validación combinada tanto en pruebas puras deterministas (Test 36) como en integración backend real (`convex/researchFixes.test.ts`):

| Civilización | Tecnologías generales visibles | Exclusivas propias visibles | Exclusivas ajenas visibles | Total catálogo visible | Intento mutación tecnología ajena |
|---|:---:|:---:|:---:|:---:|:---:|
| **Ingleses** | 87 | 4 (`tech_civ_ingleses{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Romanos** | 87 | 4 (`tech_civ_romanos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Griegos** | 87 | 4 (`tech_civ_griegos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Vikingos** | 87 | 4 (`tech_civ_vikingos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Bizantinos** | 87 | 4 (`tech_civ_bizantinos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Árabes** | 87 | 4 (`tech_civ_arabes{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Mongoles** | 87 | 4 (`tech_civ_mongoles{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Chinos** | 87 | 4 (`tech_civ_chinos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Japoneses** | 87 | 4 (`tech_civ_japoneses{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Navajos** | 87 | 4 (`tech_civ_navajos{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Aztecas** | 87 | 4 (`tech_civ_aztecas{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| **Masáis** | 87 | 4 (`tech_civ_masais{,_a,_b,_c}`) | 0 | 91 | RECHAZADO (ConvexError) |
| *Sin civilización* | 87 | 0 | 0 | 87 | RECHAZADO (ConvexError) |

---

## 6. REGISTRO REAL DE VALIDACIÓN EN UNA SOLA EJECUCIÓN

Los seis comandos fueron ejecutados en la raíz del proyecto (`/app/applet`) en el orden estricto estipulado:

### Comando 1: `npm ci`
- **Código de salida**: `0`
- **Resultado**: Instalación limpia completada en 12 segundos, 142 paquetes añadidos y auditados sin discrepancias de lockfile.

### Comando 2: `npx vitest run convex/researchFixes.test.ts`
- **Código de salida**: `0`
- **Resultado**: 
  - Archivos: `1 passed (1)`
  - Pruebas: **`10 passed (10)`**
  - Duración: `3.39s`

### Comando 3: `npm run test:integration` (`vitest run`)
- **Código de salida**: `0`
- **Resultado**:
  - Archivos de prueba: **`21 passed (21)`**
  - Pruebas ejecutadas: **`324 passed (324)`**, `0 failed`, `0 skipped`
  - Duración: `60.54s`
  - Archivos validados:
    - `convex/account.test.ts` (6 pruebas)
    - `convex/balancing.test.ts` (11 pruebas)
    - `convex/civilizations.test.ts` (8 pruebas)
    - `convex/compensation.test.ts` (34 pruebas)
    - `convex/complianceFixes.test.ts` (10 pruebas)
    - `convex/conquestRewards.test.ts` (3 pruebas)
    - `convex/kingdomColors.test.ts` (3 pruebas)
    - `convex/mapAudit.test.ts` (1 prueba)
    - `convex/mapPoints34.test.ts` (8 pruebas)
    - `convex/market.test.ts` (9 pruebas)
    - `convex/missions.test.ts` (7 pruebas)
    - `convex/parliamentDiscovery.test.ts` (2 pruebas)
    - `convex/researchFixes.test.ts` (10 pruebas)
    - `convex/spySystem.test.ts` (55 pruebas)
    - `convex/territories.test.ts` (3 pruebas)
    - Y demás suites de integración relacional.

### Comando 4: `npm run test` (`tsx scripts/runEconomicTests.ts`)
- **Código de salida**: `0`
- **Resultado**:
  - Total de pruebas: **`263`**
  - Pruebas superadas: **`263 passed`**
  - Pruebas fallidas: **`0`**
  - Duración: `247 ms`
  - Mensaje final: `TODAS LAS PRUEBAS MATEMÁTICAS Y DE INTEGRIDAD HAN SIDO SUPERADAS.`

### Comando 5: `npm run lint` (`tsc --noEmit && tsc --noEmit -p convex`)
- **Código de salida**: `0`
- **Resultado**: Verificación estricta de TypeScript para cliente React y backend Convex superada con 0 errores de compilación y 0 advertencias de tipo.

### Comando 6: `npm run build` (`tsc && vite build`)
- **Código de salida**: `0`
- **Resultado**:
  - `dist/index.html`: `1.50 kB`
  - `dist/assets/index-3OAuO7Hp.css`: `83.50 kB`
  - `dist/assets/browserBenchmarkHarness-BtTS_gfQ.js`: `10.17 kB`
  - `dist/assets/index-D6hIdl5o.js`: `1,033.91 kB`
  - Tiempo de construcción: `1.17s`

---

## 7. COMMIT FINAL Y ESTADO DEL ÁRBOL GIT

- **Commit de cabecera**: `e8ca2b625ef8024d92722f9ce09111ad082659f2`
- **Rama activa**: `main`
- **Archivos de código fuente modificados**:
  - `convex/army.ts`
  - `convex/balanceConfig.ts`
  - `convex/botRules.ts`
  - `convex/bots.ts`
  - `convex/buildingRules.ts`
  - `convex/civilizationRules.ts`
  - `convex/compensation.ts`
  - `convex/economy.ts`
  - `convex/economyAdapter.ts`
  - `convex/economyExtended.ts`
  - `convex/missionRules.ts`
  - `convex/missions.ts`
  - `convex/parliament.ts`
  - `convex/technologies.ts`
  - `convex/technologyPureTests.ts`
  - `convex/technologyRules.ts`
  - `src/components/ParliamentPanel.tsx`
- **Archivos de prueba e informe creados**:
  - `convex/researchFixes.test.ts`
  - `docs/CORRECCION_DEFINITIVA_INVESTIGACIONES.md`

---

## 8. CONCLUSIÓN Y CIERRE FORMAL

Todas las investigaciones del catálogo producen exactamente los efectos cuantitativos y cualitativos que prometen sus definiciones en todos los subsistemas (movimiento, proyecciones, almacenamiento, construcción, duración de colas, moral, espionaje y combate), se mantiene intacto el equilibrio histórico, el mapa canónico de 7.651 hexágonos y el catálogo estricto de 135 tecnologías sin invenciones improvisadas.
