# ÁRBOLES TECNOLÓGICOS DE LA CONQUISTA (DOCUMENTO MAESTRO)

Fuente de verdad oficial del catálogo de 144 investigaciones para *La Conquista*.

---

## 1. Arquitectura General y Reglas de Diseño

- **Total de investigaciones:** ~144 nodos organizados en 5 ramas interconectadas.
- **Ramas:**
  1. **Rama Económica:** Producción de recursos, capacidad de almacén, comercio y minería.
  2. **Rama Civil:** Construcción, felicidad, salud publica, medicina y crecimiento poblacional.
  3. **Rama Militar:** Instrucción de tropas, forja/armamento, táctica y logística de marchas.
  4. **Rama Inteligencia:** Espionaje, contrainteligencia, cartografía y velocidad de exploradores.
  5. **Rama Civilización:** Cadenas exclusivas de 3 nodos únicos por cada una de las 12 civilizaciones.

- **Requisitos de Infraestructura por Tier:**
  - **Universidad:** Nivel igual al Tier de la tecnología (Tier 1 = Univ 1, Tier 2 = Univ 2, Tier 3 = Univ 3, Tier 4 = Univ 4, Tier 5 = Univ 5, Tier 6 = Univ 5 o 6 según Opción B).
  - **Castillo:**
    - Tier 1: Castillo 1 o 2
    - Tier 2: Castillo 2
    - Tier 3: Castillo 3
    - Tier 4: Castillo 4
    - Tier 5: Castillo 6
    - Tier 6: Castillo 8

- **Estructura de Costes y Duración por Tier:**
  - **Tier 1:** Base ~100-300 recursos totales. Duración ~120s - 240s.
  - **Tier 2:** Base ~400-800 recursos totales. Duración ~360s - 480s.
  - **Tier 3:** Base ~1.000-2.000 recursos totales. Duración ~720s - 1.440s.
  - **Tier 4:** Base ~3.000-6.000 recursos totales. Duración ~2.880s - 5.760s.
  - **Tier 5:** Base ~10.000-20.000 recursos totales. Duración ~14.400s - 28.800s.
  - **Tier 6 (Avanzado/Élite):** Base ~30.000-60.000 recursos totales. Duración ~43.200s - 86.400s.

- **Fórmulas de Techos (`TECH_EFFECT_CAPS`):**
  - Todas las bonificaciones tecnológicas se acumulan de forma **aditiva** con un **techo máximo de seguridad**:
    - `agricultureProduction`: máx +0,65 (+65 %)
    - `woodProduction`: máx +0,65 (+65 %)
    - `stoneProduction`: máx +0,65 (+65 %)
    - `miningProduction`: máx +0,65 (+65 %)
    - `storageCapacity`: máx +1,00 (+100 %)
    - `constructionDuration`: suelo 0,60 (máxima reducción -40 %)
    - `trainingDuration`: suelo 0,60 (máxima reducción -40 %)
    - `happinessBase`: máx +30
    - `combatAttack`: máx +0,25 (+25 %)
    - `combatDefense`: máx +0,25 (+25 %)
    - `marchSpeed`: máx +0,50 (+50 %)
    - `marchFatigue`: máx -0,50 (-50 %)
    - `woundedRecoveryBonus`: máx +0,25 (+25 %, tope heridos 60 %)

---

## 2. Catálogo de Nodos por Rama

### 2.1 Rama Económica
- **Tier 1:** `agri_1`, `agri_2`, `agri_3`, `wood_1`, `stone_1`, `mining_1`, `storage_1`, `trade_1`.
- **Tier 2:** `agri_4`, `agri_5`, `agri_6`, `mining_2`, `mining_3`, `storage_2`, `trade_2`.
- **Tier 3:** `agri_7`, `wood_2`, `stone_2`, `mining_4`, `storage_3`, `trade_3`.
- **Tier 4:** `agri_8`, `wood_3`, `stone_3`, `mining_5`, `storage_4`, `trade_4`.
- **Tier 5:** `agri_9`, `production_mastery`, `trade_mastery`.

### 2.2 Rama Civil
- **Tier 1:** `construction_1`, `construction_2`, `happiness_1`, `happiness_2`, `medicine_1`.
- **Tier 2:** `construction_3`, `happiness_3`, `happiness_4`, `medicine_2`, `medicine_3`.
- **Tier 3:** `construction_4`, `happiness_5`, `medicine_4`, `architecture_1`.
- **Tier 4:** `construction_5`, `construction_6`, `architecture_2`, `public_works`.
- **Tier 5:** `monumental_architecture`, `utopia_planning`.

### 2.3 Rama Militar
- **Tier 1:** `training_1`, `training_2`, `weapons_1`, `armor_1`, `tactics_1`.
- **Tier 2:** `training_3`, `forge_1`, `forge_2`, `forge_3`, `logistics_1`, `logistics_2`.
- **Tier 3:** `training_4`, `forge_4`, `forge_5`, `advanced_steel`, `tactics_2`.
- **Tier 4:** `master_forge`, `heavy_armor`, `siege_mastery`, `conscription_1`.
- **Tier 5:** `grand_strategy`, `military_supremacy`.

### 2.4 Rama Inteligencia
- **Tier 1:** `espionage_1`, `cartography_1`.
- **Tier 2:** `espionage_2`, `spy_1`, `spy_2`, `recon_1`.
- **Tier 3:** `espionage_3`, `counter_intel_1`, `cartography_2`.
- **Tier 4:** `shadow_network`, `master_scouts`.
- **Tier 5:** `omniscience`.

### 2.5 Rama Civilización (3 Nodos por Civilización = 36 Nodos)
- **Ingleses:** `tech_civ_ingleses_a`, `tech_civ_ingleses_b`, `tech_civ_ingleses_c`.
- **Romanos:** `tech_civ_romanos_a`, `tech_civ_romanos_b`, `tech_civ_romanos_c`.
- **Griegos:** `tech_civ_griegos_a`, `tech_civ_griegos_b`, `tech_civ_griegos_c`.
- **Vikingos:** `tech_civ_vikingos_a`, `tech_civ_vikingos_b`, `tech_civ_vikingos_c`.
- **Bizantinos:** `tech_civ_bizantinos_a`, `tech_civ_bizantinos_b`, `tech_civ_bizantinos_c`.
- **Árabes:** `tech_civ_arabes_a`, `tech_civ_arabes_b`, `tech_civ_arabes_c`.
- **Mongoles:** `tech_civ_mongoles_a`, `tech_civ_mongoles_b`, `tech_civ_mongoles_c`.
- **Chinos:** `tech_civ_chinos_a`, `tech_civ_chinos_b`, `tech_civ_chinos_c`.
- **Japoneses:** `tech_civ_japoneses_a`, `tech_civ_japoneses_b`, `tech_civ_japoneses_c`.
- **Navajos:** `tech_civ_navajos_a`, `tech_civ_navajos_b`, `tech_civ_navajos_c`.
- **Aztecas:** `tech_civ_aztecas_a`, `tech_civ_aztecas_b`, `tech_civ_aztecas_c`.
- **Masáis:** `tech_civ_masais_a`, `tech_civ_masais_b`, `tech_civ_masais_c`.

---

## Decisiones confirmadas

1. **Ranura única:** Se fija exactamente una investigación activa a la vez. `MAX_SLOTS = 1` y todos los valores en `RESEARCH_SLOTS_BY_UNIVERSITY` se establecen en 1.
2. **Opción B (Edificios):** Ningún requisito de tecnología puede superar el nivel máximo real alcanzable del edificio.
   - Reajustes: Mercado nivel máx 5 (`trade_4`), Herrería nivel máx 5 (`forge_4`, `forge_5`, `forge_6`), Hospital militar nivel máx 5 (`medical_5`), Universidad nivel máx 5 (Universidad 6 pasa a 5).
3. **Especificación P24:**
   - `medicine_1` pasa a exigir Castillo 2 + Universidad 2.
   - `advanced_steel` pasa a Universidad 3 (mantiene Castillo 5 y Herrería 4).
4. **Civilizaciones canónicas:**
   - Nombres oficiales: **Navajos** (antes "Indios americanos") y **Masáis** (antes "Keniatas").
   - Los identificadores técnicos antiguos (`indiosAmericanos`, `keniatas`) se mantienen únicamente como alias de retrocompatibilidad en `LEGACY_CIVILIZATION_IDS` y `LEGACY_TECHNOLOGY_IDS`.
5. **Techos de Efectos (`TECH_EFFECT_CAPS`):**
   - Suma aditiva con suelo/techo de seguridad.
   - `constructionDuration` y `trainingDuration` con suelo en `0,60` (reducción máxima del 40 %).
6. **Requisitos de Edificios Iniciales (Ajustes de Nodos Nuevos):**
   - **Granja:** `agri_4`, `agri_5` y `agri_6` requieren Granja 12; `agri_7` requiere Granja 14; `agri_8` requiere Granja 16.
   - **Viviendas:** Se elimina la exigencia de Viviendas en `construction_5`, `construction_7` y `tech_civ_navajos_b`.
   - **Cantera:** `mining_5` y `construction_4` exigen Cantera 5; `construction_6` exige Cantera 6.
   - **Aserradero:** `mining_4` y `tech_civ_aztecas_a` exigen Aserradero 5.
   - **Mina de hierro y Mina de oro:** Sin cambios.
