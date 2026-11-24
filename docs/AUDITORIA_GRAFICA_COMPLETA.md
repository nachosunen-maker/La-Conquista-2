# Auditoría Gráfica Exhaustiva — *La Conquista*

> **Fase:** Punto 7 — Auditoría gráfica, clasificación de componentes y asignación definitiva de identificadores numéricos.  
> **Regla de integridad:** Inspección directa exclusiva del código fuente actual (`src/` y `convex/`). No se han generado, descargado ni añadido imágenes binarias ni modificado módulos funcionales del juego.  
> **Nota de entorno:** El espacio de trabajo local (`/app/applet`) no incluye metadatos `.git`, por lo que la auditoría toma como fuente de verdad directa el árbol real de archivos actual de `src/`, `convex/` y `public/`. Asimismo, se descarta explícitamente `docs/AUDITORIA_IMAGENES_PERSONALIZADAS.md` como fuente de verdad al tratarse de un borrador obsoleto que referencia ficheros inexistentes (`Map.tsx`, `Buildings.tsx`, `Army.tsx`) y terrenos ajenos al juego (`Desierto`).

---

## 1. Resumen ejecutivo y totales del catálogo

La auditoría completa de `convex/balanceConfig.ts`, `convex/botConfig.ts`, `src/App.tsx`, los 14 módulos de `src/components/` y el motor cartográfico `src/map/` identifica **424 elementos visuales** elegibles para miniatura gráfica, *sprite* hexagonal o ilustración dedicada, distribuidos dentro de los 7 rangos numéricos reservados sin colisiones ni huecos ambiguos:

| Categoría | Rango reservado | Rango asignado | Total elementos | Desglose exacto |
|---|---|---|---|---|
| **1. Edificios** | `0001–0099` | `0001–0030` | **30** | `0001–0018`: 18 edificios base (`BUILDINGS`) · `0019–0030`: 12 variantes culturales (`CIVILIZATION_IDENTITIES.uniqueBuilding`) |
| **2. Civilizaciones, escudos y emblemas** | `0100–0199` | `0101–0113` | **13** | `0101–0112`: 12 emblemas heráldicos (`CIVILIZATIONS`) · `0113`: emblema de reino neutral/independiente |
| **3. Tropas, espías, mercenarios y asedio** | `0200–0399` | `0201–0269` | **69** | `0201–0248`: 48 unidades culturales (12 civs × 4 plazas `unitNames`, comenzando por `0201_samurai_infanteria.webp` y `0202_samurai_arqueria.webp`) · `0249–0252`: 4 siluetas base universales · `0253`: `espia` · `0254–0263`: 10 máquinas de asedio especializadas (`UNIT_TYPES`) · `0264–0269`: 6 mercenarios (`MERCENARIES.TYPES`) |
| **4. Tecnologías e investigaciones** | `0400–0599` | `0401–0591` | **191** | `107` universales (`economica`, `civil`, `militar`, `inteligencia`) + `84` exclusivas de civilización (`7 × 12` en rama `civilizacion`), comenzando por `0401_rotacion_cultivos.webp` (`agri_1`) |
| **5. Recursos y bienes** | `0600–0699` | `0601–0618` | **18** | `0601–0605`: 5 recursos primarios (`gold`, `wood`, `stone`, `iron`, `food`) · `0606–0614`: 9 bienes/indicadores del reino · `0615–0618`: 4 estaciones (`SEASONS`) |
| **6. Terrenos y cartografía** | `0700–0799` | `0701–0720` | **20** | `0701–0706`: 6 miniaturas 1:1 de panel (`TERRAINS`) · `0707`: niebla UI · `0708–0713`: 6 *sprites* hexagonales `256×296` (`TerrainAssetProvider`) · `0714`: *hex* niebla · `0715–0716`: fortalezas capital propia/rival · `0717–0720`: 4 marcadores cartográficos |
| **7. Misiones, recompensas, equipo, doctrinas, monarcas y pantallas** | `0800–0999` | `0801–0836`, `0840–0886` | **83** | `0801–0805`: 5 armas · `0806–0810`: 5 armaduras · `0811–0815`: 5 rangos militares · `0816–0818`: 3 estrategias · `0819–0822`: 4 formaciones tácticas · `0823–0825`: 3 políticas de descanso · `0826–0833`: 8 sellos de misión/recompensa/tributo · `0834–0836`: 2 pantallas + escudo principal · `0840–0886`: 47 retratos de monarcas bots (`botConfig.ts`) |
| **TOTAL CATÁLOGO** | `0001–0999` | — | **424** | **100 % verificable frente a `balanceConfig.ts` y `botConfig.ts`** |

---

## 2. Inventario exhaustivo por pantalla, componente y módulo real

### 2.1 Entrada, autenticación y fundación de reino

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `index.html` | Sin favicon personalizado; metadatos `og:title` / `og:description` sin `og:image`. | `0836_escudo_juego_la_conquista.webp` utilizable como `<link rel="icon">` y recurso social. | Pendiente |
| `src/components/HomeScreen.tsx` | Renderiza `<img src="/assets/aistudio/1793086836321_852e3733.jpg" />` en modo escritorio y móvil; lista las 12 civilizaciones (`OFFICIAL_CIVILIZATIONS`) mediante emojis (`🏹`, `🏛️`, `🏺`, `⚔️`, `🛡️`, `🌙`, `🐎`, `🏮`, `⛩️`, `🦅`, `☀️`, `🌾`). | Fondo principal estandarizado a `0834_pantalla_inicio_heroe.webp`; emblemas sustituidos por `0101–0112`; escudo superior por `0836`. | Pendiente |
| `src/components/AccessPanel.tsx` | Tarjeta de acceso, registro y recuperación con borde decorativo SVG `CornerAccent` e iconos funcionales `lucide-react` (`Eye`, `EyeOff`, `Loader2`, `Check`, `Copy`, `AlertCircle`). | `CornerAccent` y los iconos de formulario permanecen como vector decorativo / icono funcional. | No requiere imagen |
| `src/components/FoundingWizard.tsx` | Asistente en 5 pasos para elegir civilización y fundar reino. Muestra nombre, lema, edificio único, tropa insignia y emojis de civilización y recursos. | Emblemas `0101–0112`, edificios únicos `0019–0030`, tropas insignia de `0201–0248`, fondo de pergamino/atlas `0835_pantalla_fundacion_reino.webp`. | Pendiente |
| `src/components/KingdomCreationWizard.tsx` | **Componente no montado actualmente en `App.tsx`** (asistente alternativo en 3 pasos presente en `src/components/`). Muestra las 12 civilizaciones con emojis y resumen económico. | Si se reactivase, consumiría los mismos `0101–0112`. | Secundario / cubierto |

### 2.2 Cascarón principal, navegación, Aldea y Mercado (`src/App.tsx`, `TabNavigation.tsx`, `MarketPanel.tsx`)

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `src/components/TabNavigation.tsx` | 5 pestañas principales (`Aldea`, `Ejército`, `Universidad`, `Parlamento`, `Mapa`) con iconos `lucide-react` (`Castle`, `Swords`, `GraduationCap`, `Landmark`, `Map`) y insignia numérica de desafíos pendientes. | **Iconos funcionales de navegación:** deben mantenerse como iconos vectoriales crisp (`lucide-react`) para responder al color activo `#d4af37` / `#8e816d` en escritorio y barra móvil fija. | Permanece como icono |
| `src/App.tsx` (Cabecera y métricas globales) | Escudo/emblema textual, 5 `resourceCards` (`Oro`, `Madera`, `Piedra`, `Hierro`, `Alimentos`) con `ResourceSparkline` SVG y texto/iconos `lucide-react`; indicadores de población (`2.000+`), felicidad (`0–100`), moral (`0–100`), capacidad de almacén, régimen de raciones, impuestos, estación (`SEASONS`: Primavera/Verano/Otoño/Invierno) y tarjeta `OutageCompensationCard`. | `0101–0112` (emblema del reino), `0601–0605` (5 recursos en tarjetas y barra), `0606–0613` (bienes/indicadores), `0615–0618` (4 estaciones), `0832` (`OutageCompensationCard` / recompensa). `ResourceSparkline` SVG y `ConnectionStatusBadge` permanecen como UI vectorial/icono. | Pendiente |
| `src/App.tsx` (Pestaña Aldea — Cola y 18 edificios) | Líneas 2508–2764: agrupa los 18 edificios en 6 subcategorías (`Administración`, `Producción`, `Infraestructura`, `Militar`, `Conocimiento`, `Servicios y bienestar`) con iconos de cabecera (`Crown`, `Pickaxe`, `Castle`, `Swords`, `BookOpen`, `Heart`), pero **cada fila de edificio carece hoy de miniatura propia**. Incluye selector de `REST_POLICIES` (`normal`, `intensiva`, `relajada`) y distribución de oficios. | `0001–0018` para los 18 edificios base; `0019–0030` cuando corresponda al `uniqueBuilding` de la civilización; `0823–0825` para las 3 políticas de descanso del Castillo. | Pendiente |
| `src/components/BuildingsAndQueue.tsx` | **Componente no montado en `App.tsx`** (referencia `{item.buildingEmoji}` y `{b.emoji}` de `kingdoms:getBuildingsAndQueue`). | Cubierto íntegramente por `0001–0030`. | Secundario / cubierto |
| `src/components/MarketPanel.tsx` | Usa emojis `MARKET_RESOURCE_EMOJIS` (`🪙`, `⚔️`, `🪨`, `🪵`, `🌾`) e icono `ArrowLeftRight` en tasas e historial de intercambios. | `0601–0605` (recursos intercambiables) y `0614_bien_mercado_intercambio.webp` (cabecera de trueque real). `ArrowLeftRight` permanece como icono funcional. | Pendiente |

### 2.3 Ejército, equipamiento, doctrinas y reclutamiento (`ArmyPanel.tsx`, `TroopSelector.tsx`)

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `src/components/ArmyPanel.tsx` | Sección I–III: 6 tarjetas KPI, barra de rango militar global (niveles 1–5 `MILITARY_LEVELS`), inventario filtrable de tropas (`UNIT_TYPES`), cola de reclutamiento, contratación de los 6 tipos de mercenarios de Taberna (`MERCENARIES.TYPES`), sección de Espías (`espia`), 4 formaciones tácticas (`TACTICAL_FORMATIONS`), 3 estrategias (`STRATEGIES`), 5 niveles de armas (`WEAPONS`) y 5 de armaduras (`ARMORS`), más ficha de `signatureUnit`. Todo se representa hoy con texto, badges e iconos `lucide-react` (`Sword`, `Shield`, `Sparkles`, etc.), sin miniaturas. | `0201–0248` (48 tropas culturales), `0249–0252` (base fallback), `0253` (espía), `0254–0263` (10 máquinas de asedio), `0264–0269` (6 mercenarios), `0801–0805` (5 armas), `0806–0810` (5 armaduras), `0811–0815` (5 rangos), `0816–0818` (3 estrategias), `0819–0822` (4 formaciones). | Pendiente |
| `src/components/TroopSelector.tsx` | **Componente modal presente en `src/components/`, actualmente sin importar desde `MapPanel.tsx` o `App.tsx`.** Muestra inventario y selector de tropas para expediciones/ataques. | Cubierto por `0201–0269`. | Secundario / cubierto |

### 2.4 Universidad y tecnologías (`UniversityPanel.tsx`)

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `src/components/UniversityPanel.tsx` | Muestra el catálogo completo de **191 tecnologías** repartidas en 5 ramas (`economica`, `civil`, `militar`, `inteligencia`, `civilizacion`) y niveles 1–8 de Universidad, con ranuras activas (1–3) y 4 estados (`Investigada`, `En curso`, `Disponible`, `Bloqueada`). Actualmente usa solo tarjetas tipográficas e insignias de estado, sin ilustración por tecnología. | `0401–0591` asigna un identificador individual y único a cada una de las **191 tecnologías reales** de `convex/balanceConfig.ts`, comenzando en `0401_rotacion_cultivos.webp` (`agri_1`). | Pendiente |

### 2.5 Parlamento, misiones, diplomacia y bots (`ParliamentPanel.tsx`, `MissionsPanel.tsx`)

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `src/components/ParliamentPanel.tsx` | Bonus diario (`DAILY_BONUS`), selector de impuestos, desafíos pendientes/activos, 5 mensajes predefinidos, catálogo de rivales con los **5 bots permanentes + 5 rotatorios semanales** provenientes del catálogo de **47 monarcas** de `convex/botConfig.ts`, ranking de Honor/Gloria (con emojis `🥇🥈🥉`) e historial de batallas. | `0101–0112` (emblema de civilización de cada rival), `0113` (neutral), `0609–0610` (`honor` y `glory`), `0833_bonus_diario.webp`, `0840–0886` (retratos de los **47 monarcas históricos de `botConfig.ts`**). Los emojis/medallas pequeñas de posición en tabla pueden reemplazarse opcionalmente por texto o insignia CSS. | Pendiente |
| `src/components/MissionsPanel.tsx` | Misiones progresivas en 4 etapas (`STAGES`: 22 hitos), 6 misiones diarias (`DAILY.CATALOG`), 4 secretas generales (`SECRET`) + 12 secretas de civilización (`SECRET_PER_CIVILIZATION_TITLES`), además de `MissionCelebrations`. | `0826–0829` (4 medallones de etapa), `0830_mision_diaria.webp`, `0831_mision_secreta.webp`, `0832_cofre_recompensa_mision.webp`, combinados con los recursos/tropas de recompensa (`0601–0605`, `0609–0610`, `0201–0248`). | Pendiente |

### 2.6 Mapa hexagonal 2D y cartografía (`MapPanel.tsx`, `src/map/mapRenderer.ts`, `src/map/terrainVisuals.ts`)

| Archivo real | Elementos visuales actuales | Sustitución / Cobertura asignada en catálogo | Estado |
|---|---|---|---|
| `src/components/MapPanel.tsx` | Leyenda de 6 terrenos + niebla (hoy solo muestras de color CSS), panel lateral de inspección de celda `(q, r)`, lista de provincias, crónica y `ActiveActivitiesSection` (expediciones de exploración, misiones de espionaje y marchas militares en curso). | `0701–0706` (miniaturas cuadradas 1:1 de los 6 terrenos en leyenda/inspector), `0707` (miniatura 1:1 de niebla), `0717–0719` (marcadores de exploración, espionaje y marcha). Botones de zoom `+`/`-`/`Crosshair` permanecen como iconos `lucide-react`. | Pendiente |
| `src/map/terrainVisuals.ts` y `src/map/mapRenderer.ts` | Disco de radio `50` (`7.651` hexágonos *pointy-top*, `hexMath.ts`). Ya define la interfaz `TerrainAssetProvider` con `getTerrainSprite(terrain, variant, lod)` y `getCapitalSprite(isOwnCapital, lod)`, actualmente con respaldo procedural en Canvas 2D (`drawIllustratedTerrainHex`, `drawFogHex`, `drawMedievalCapitalFortress`, `drawProvinceBanner`). | `0708–0713` (*sprites* hexagonales `256×296` de los 6 terrenos con soporte para 3 variantes `_v0/_v1/_v2`), `0714` (*sprite* hexagonal niebla), `0715–0716` (fortaleza capital propia y rival en `256×296`), `0720` (estandarte cartográfico de provincia). | Pendiente |

---

## 3. Decisiones explícitas sobre variantes, unificación y exclusiones

1. **Edificios base (`0001–0018`) vs. Edificios únicos por civilización (`0019–0030`):**
   - Los 18 edificios de `BUILDINGS` reciben exactamente los identificadores fijos `0001` a `0018` según la especificación.
   - En `convex/balanceConfig.ts` (`CIVILIZATION_IDENTITIES[civ].uniqueBuilding`), cada una de las 12 civilizaciones otorga nombre y arquitectura propia a uno de los edificios base (por ejemplo, `Campo de Tiro` inglés sobre `cuartel`, `Castra` romana sobre `cuartel`, `Liceo` griego sobre `universidad`, `Templo Mayor` azteca sobre `iglesia`, `Ger del Kan` mongol sobre `viviendas`, `Boma` masái sobre `viviendas`). Para preservar la fidelidad histórica se asignan **12 entradas dedicadas (`0019–0030`)** con respaldo automático (*fallback*) a su edificio base (`0001–0018`) hasta que se produzcan.
2. **Tropas culturales (`0201–0248`) vs. Universales (`0249–0252`), Espía (`0253`), Asedio especializado (`0254–0263`) y Mercenarios (`0264–0269`):**
   - Respetando los ejemplos normativos `0201_samurai_infanteria.webp` y `0202_samurai_arqueria.webp`, los IDs `0201–0204` corresponden a los japoneses y `0205–0248` completan las 4 plazas (`infanteria`, `arqueria`, `caballeria`, `asedio`) de las otras 11 civilizaciones definidas en `CIVILIZATION_IDENTITIES.unitNames` (`48` miniaturas culturales).
   - Se añaden 4 siluetas genéricas universales (`0249–0252`) para vistas globales o respaldo, 1 entrada dedicada para `espia` (`0253`), las 10 piezas especializadas de asedio de `UNIT_TYPES` (`0254–0263`) y los 6 cuerpos mercenarios de `MERCENARIES.TYPES` (`0264–0269`).
3. **Tecnologías (`0401–0591` = 191 entradas):**
   - Todas las **191 tecnologías reales** de `TECHNOLOGIES` (`107` universales + `84` exclusivas de civilización) reciben un ID individual correlativo a partir de `0401` (`0401_rotacion_cultivos.webp` para `agri_1`) hasta `0591` (`tech_civ_masais_f`), en el orden canónico exacto de `convex/balanceConfig.ts`.
   - *Exclusión verificada:* la nota del código en `convex/balanceConfig.ts` (línea 1232) confirma que `form_1-7`, `forge_1` y `forge_6` están aplazados y no existen en el catálogo; por tanto **no se inventan ni numeran**.
4. **Equipamiento (`0801–0810`):**
   - Los 5 niveles de armas (`WEAPONS`: `0801–0805`) y 5 de armaduras (`ARMORS`: `0806–0810`) se catalogan inicialmente como 10 miniaturas canónicas compartidas entre civilizaciones; la columna `Variantes` documenta las denominaciones culturales específicas de `CIVILIZATION_IDENTITIES.weapons` y `.armors` por si en una fase futura se decidiera ampliar a sub-variantes (`-civ`).
5. **Terrenos en UI vs. Terrenos en Canvas (`0701–0720`):**
   - Se separan explícitamente las **miniaturas cuadradas 1:1 de panel** (`0701–0707`, sin necesidad de recorte hexagonal) de los ***sprites* hexagonales *pointy-top* `256×296`** (`0708–0716`, con máscara alfa y soporte de variantes deterministas `_v0/_v1/_v2` para `TerrainAssetProvider`).

---

## 4. Auditoría de archivos de imagen ya presentes en el repositorio

El análisis de los directorios `/public/assets/` y `/src/assets/images/` detectó las siguientes imágenes preexistentes. **Ninguna cumple todavía el estándar `.webp` ni la nomenclatura `ID_nombre.webp`**:

| Ruta actual en repositorio | Peso (bytes) | ¿Referenciada en código? | Hallazgos y duplicados | Equivalente futuro en catálogo |
|---|---|---|---|---|
| `public/assets/aistudio/1793086836321_852e3733.jpg` | `276.513` | **Sí** (`src/components/HomeScreen.tsx` líneas 55 y 83) | Única imagen realmente mostrada al usuario hoy. Formato `.jpg`, ruta temporal de `aistudio/`. | `0834_pantalla_inicio_heroe.webp` |
| `public/assets/inicio_la_conquista_oficial.png` | `2.493.564` | **No** | Duplicado exacto byte-a-byte de los 2 archivos siguientes (`2.49 MB` sin comprimir). | Candidato fuente para revisar/convertir a `0834` o `0836` |
| `public/assets/aistudio/a_cinematic_high_fantasy_medieval_game_login_intr_097b7d22.png` | `2.493.564` | **No** | Copiado idéntico de `inicio_la_conquista_oficial.png`. | Borrador duplicado (limpiar en fase de integración) |
| `src/assets/images/inicio_la_conquista_oficial.png` | `2.493.564` | **No** | Tercera copia idéntica en `src/assets/`. | Borrador duplicado |
| `src/assets/images/inicio_la_conquista_1792919730892.jpg` | `819.218` | **No** | Versión alternativa huérfana sin importar. | Borrador histórico |
| `public/assets/images/units/unidad_ingles_arquero_arco_largo.jpg` | `83.442` | **No** | Duplicado exacto de `public/assets/aistudio/1793546686336_f642fb4d.jpg`. Sin uso en `ArmyPanel.tsx`; formato `.jpg` fuera de estándar. | Referencia previa para `0206_ingleses_arqueria_arquero_de_arco_largo.webp` |
| `public/assets/images/units/unidad_romana_legionario.png` | `1.699.658` | **No** | Duplicado exacto de `public/assets/aistudio/file_000000005c4c824385c76cdb3b6f7b87_243b6aed.png`. `1.70 MB` sin uso en UI. | Referencia previa para `0209_romanos_infanteria_legionario.webp` |

> Por rigor técnico, todas las filas del catálogo (`0001–0886`) figuran en estado **`pendiente de producir`** bajo el estándar definitivo `.webp` descrito en `docs/ESPECIFICACION_TECNICA_MINIATURAS.md`.

---

## 5. Elementos explícitamente excluidos de rasterización (Iconos funcionales y decorativos)

De acuerdo con la auditoría de UI, los siguientes elementos **no deben convertirse en imágenes rasterizadas** para preservar accesibilidad, nitidez en pantallas HiDPI, peso mínimo y cambios dinámicos de color por estado:

1. **Iconos funcionales de interfaz (`lucide-react` — permanecer como icono):**
   - Navegación principal (`TabNavigation.tsx`): `Castle`, `Swords`, `GraduationCap`, `Landmark`, `Map`.
   - Subcategorías de Aldea (`App.tsx` líneas 2512–2548): `Crown`, `Pickaxe`, `Castle`, `Swords`, `BookOpen`, `Heart`.
   - Controles de utilidad en `AccessPanel.tsx`, `App.tsx`, `ArmyPanel.tsx`, `MarketPanel.tsx` y `MapPanel.tsx`: `Wifi`, `WifiOff`, `Loader2`, `CheckCircle2`, `AlertCircle`, `Plus`, `Minus`, `Crosshair`, `Eye`, `EyeOff`, `Copy`, `Check`, `ChevronDown`, `ChevronUp`, `Clock`, `LogOut`, `RefreshCw`, `ArrowLeftRight`, `Trash2`, `Info`, `Lock`, `Unlock`, `Shield`, `Sparkles`, `Sword`.
2. **Elementos decorativos y geométricos dinámicos (no requieren imagen):**
   - `CornerAccent` (ornamento SVG de esquina en `AccessPanel.tsx`).
   - `ResourceSparkline` (gráfico SVG dinámico de tendencia de recursos en `App.tsx`).
   - Marcos, gradientes y sombreados Tailwind (`bg-[#120f0c]`, `border-[#3d3221]`, `shadow-md`).
   - Vectores dinámicos dependientes de cámara/estado en `src/map/mapRenderer.ts`: cuadrícula de coordenadas, bordes de frontera entre reinos, halos de selección/hover y líneas punteadas de trayectorias activas.
