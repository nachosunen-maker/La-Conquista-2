# Especificación Técnica de Miniaturas y Recursos Gráficos — *La Conquista*

> **Documento normativo para producción visual e integración futura (Punto 7).**  
> **Estado actual:** Auditoría y especificación aprobadas sin generación ni incorporación binaria de imágenes en esta fase.

---

## 1. Objetivo y alcance

Esta especificación define los estándares de formato, dimensiones, proporciones, canal alfa, márgenes de seguridad, nomenclatura, estructura de directorios y mecanismos de respaldo (*fallback*) aplicables a los **424 recursos gráficos** numerados en `docs/CATALOGO_NUMERICO_MINIATURAS.md` y `docs/CATALOGO_NUMERICO_MINIATURAS.csv`.

Todos los parámetros técnicos se derivan directamente de la arquitectura real de *La Conquista* (`src/App.tsx`, `src/components/*.tsx`, `src/map/mapRenderer.ts`, `src/map/terrainVisuals.ts`, `src/map/hexMath.ts` y `convex/balanceConfig.ts`).

---

## 2. Dirección artística y coherencia de interfaz

- **Paleta base de la aplicación (`index.html` y `src/components/shared.tsx`):**  
  Fondos oscuros cálidos (`#0e0d0b`, `#120f0c`, `#141210`, `#1a1510`), bordes bronce/ámbar envejecido (`#2b2419`, `#3d3221`, `#6e5520`), acentos dorados (`#c5a059`, `#d4af37`) y tipografía clásica (`Cinzel`, `MedievalSharp`, `Inter`).
- **Estilo visual unificado:** Ilustración medieval/histórica de alta definición con iluminación cálida lateral, contornos definidos para lectura a tamaños pequeños (`32–56 px`), sin texto incrustado, sin marcas de agua, sin marcos de UI ni botones superpuestos dentro de la imagen.
- **Rigor histórico por civilización (regla obligatoria de `convex/balanceConfig.ts` — `CIVILIZATION_IDENTITIES`):**
  - **Ingleses (ss. XI–XV):** Arco largo de tejo, cotas de malla, arnés de placas, trabuquetes.
  - **Romanos (Alto Imperio):** *Gladius*, *pilum*, *lorica segmentata*, *scutum*, onagros.
  - **Griegos (Clásicos):** Hoplitas con *dory* y *hoplon*, coraza de bronce/*linothorax*, trirreme/oxybeles.
  - **Vikingos (ss. VIII–XI):** **Cascos sin cuernos** (prohibición explícita en código), hacha danesa, escudo redondo, *brynja*, *drakkar*.
  - **Bizantinos (Periodo medio):** Catafractos con *kontos*, armadura lamelar *klivanion*, fuego griego, *helépolis*.
  - **Árabes (Califatos):** Arco compuesto, espada *sayf*, cota *dir'*, jinete ligero, norias y caravasares.
  - **Mongoles (ss. XIII–XIV):** Jinetes arqueros de arco compuesto, armadura lamelar/cuero lacado, *gers* de fieltro, estribos.
  - **Chinos (Dinastía Song):** Ballestas de repetición, armadura laminada *shanwenjia*, terrazas de arroz, pólvora temprana.
  - **Japoneses (Sengoku):** *Samurái* con *katana*, *yari* y arco *yumi* (*ashigaru*), armadura *dō-maru* / *gusoku*, acero *tamahagane*.
  - **Navajos (Diné):** Rastreadores de cañón y bosque, arco compuesto de madera/tendón, punta de sílex, vestimenta Diné de piel/cuero crudo; **sin armaduras metálicas europeas**.
  - **Aztecas (ss. XIV–XVI):** **Sin caballos ni acero europeo** (el puesto de caballería corresponde a *Guerrero Jaguar* de élite a pie); armas de obsidiana (*macuahuitl*, *tepoztopilli*), *atlatl*, *ichcahuipilli* de algodón y escudo *chimalli*.
  - **Masáis:** Lanzas *ol-alem*, espada corta *seme*, manta *shúkà* y escudo ovalado de cuero de búfalo *el-longo*, recinto *boma*.

---

## 3. Estándares de archivo maestro y exportación

### 3.1 Formatos permitidos

| Uso | Archivo maestro de archivo/edición | Archivo final en producción (`runtime`) | Compresión recomendada |
|---|---|---|---|
| Miniaturas UI con transparencia (edificios, emblemas, tropas, tecnologías, recursos, equipo, insignias, iconos cartográficos) | PNG RGBA 32-bit | **WebP con canal alfa** | WebP *lossless* o `q=92` con alfa sin pérdida (`alpha-q=100`) |
| Miniaturas UI opacas / Retratos de monarcas / Miniaturas de terreno para tarjetas | PNG RGB/RGBA | **WebP** | WebP `q=90` |
| Sprites hexagonales del mapa (`TerrainAssetProvider`) | PNG RGBA 32-bit | **WebP con canal alfa** (máscara hexagonal *pointy-top*) | WebP *lossless* o `q=92` |
| Ilustraciones panorámicas de pantalla (`0834`, `0835`) | PNG RGB 24-bit | **WebP** (sin alfa) | WebP `q=85` (objetivo `< 250 KB`) |

> **Nota sobre compatibilidad con activos legados:** En disco existen actualmente archivos `.jpg` y `.png` previos sin estandarizar (véase sección 5 de `docs/AUDITORIA_GRAFICA_COMPLETA.md`). Ninguno debe utilizarse como patrón; la producción definitiva usará exclusivamente `.webp` según este estándar.

### 3.2 Dimensiones maestras, proporciones y márgenes de seguridad

1. **Miniaturas cuadradas estándar (`1:1`):**
   - **Resolución maestra de exportación:** `256 × 256 px` (para retratos destacados `0840–0886` o escudo principal `0836` se permite maestro fuente `512 × 512 px` reescalado a `256 × 256 px` en runtime).
   - **Margen interior de seguridad (*safe padding*):** **8 %–10 % por lado** (`20–26 px` sobre lienzo de `256 × 256 px`) para fondos transparentes. Garantiza que las esquinas redondeadas (`rounded-lg`, `rounded-xl`, `rounded-full`) y los bordes de tarjeta (`border-[#3d3221]`) nunca corten picos de lanzas, escudos o almenas.
   - **Peso objetivo por archivo WebP `256×256`:** `12 KB – 45 KB`.

2. **Sprites hexagonales del mapa 2D (`src/map/terrainVisuals.ts`):**
   - **Geometría obligatoria:** Hexágono vertical (*pointy-top*, ángulos `-30°, 30°, 90°, 150°, 210°, 270°` en `HEX_UNIT_VERTICES` de `src/map/hexMath.ts`).
   - **Proporción exacta:** Anchura `W = √3 · h`, Altura `H = 2 · h`, relación `W : H = √3 / 2 ≈ 0.8660 : 1`.
   - **Resolución maestra exacta:** **`256 × 296 px`** (`256 / 296 = 0.8649 ≈ √3/2`).
   - **Transparencia:** Obligatoria fuera de la silueta del hexágono *pointy-top* (`alpha = 0` en las 4 esquinas triangulares exteriores). Para relieves que sobresalen ligeramente en cumbres de `hex_montana` (`0713`) o torres de `hex_capital_*` (`0715–0716`), mantener el exceso vertical dentro del `6 %` superior y centrado en el hexágono.
   - **Sistema de variantes deterministas:** `src/map/hexMath.ts` (`visualVariantHash`) calcula un índice `0..3` por celda `(q, r)`. Cada sprite de terreno del mapa (`0708–0713`) admite sufijos opcionales `_v0.webp`, `_v1.webp`, `_v2.webp` (con respaldo a `_v0` o archivo base si falta variante) para evitar repetición visual en extensiones continuas de llanuras o bosques.
   - **Integración con caché LOD:** `TerrainStampCache` en `src/map/terrainVisuals.ts` pre-renderiza sellos en caché según el zoom (`overview`, `medium`, `detail`), por lo que el arte de `256 × 296 px` debe conservar siluetas legibles incluso al reducirse a `20–30 px` de alto en vista `overview`.

3. **Ilustraciones panorámicas de pantalla (`16:9`):**
   - **Resolución maestra:** `1280 × 720 px` (`16:9`, sin alfa, peso `< 250 KB`).
   - **Aplicable a:** `0834_pantalla_inicio_heroe.webp` (`HomeScreen.tsx`) y `0835_pantalla_fundacion_reino.webp` (`FoundingWizard.tsx`).

### 3.3 Tamaños de renderizado previstos en la UI

| Categoría | IDs | Tamaño maestro | Tamaño CSS típico en UI | Contenedor / Contexto |
|---|---|---|---|---|
| Edificios (`0001–0030`) | `0001–0030` | `256 × 256` | `44 × 44 px` – `56 × 56 px` | `App.tsx` (Aldea), `BuildingsAndQueue.tsx` (cola de obras) |
| Emblemas de civilización (`0101–0113`) | `0101–0113` | `256 × 256` | `24 × 24 px` (header/tabla), `48 × 48 px` (cards) | `HomeScreen.tsx`, `FoundingWizard.tsx`, `App.tsx`, `ParliamentPanel.tsx` |
| Tropas, espías, mercenarios, asedio (`0201–0269`) | `0201–0269` | `256 × 256` | `40 × 40 px` (cola), `56 × 56 px` – `64 × 64 px` (catálogo/tarjetas) | `ArmyPanel.tsx`, `TroopSelector.tsx` |
| Tecnologías (`0401–0591`) | `0401–0591` | `256 × 256` | `40 × 40 px` – `48 × 48 px` | `UniversityPanel.tsx` |
| Recursos y bienes (`0601–0618`) | `0601–0618` | `256 × 256` | `20 × 20 px` – `36 × 36 px` | `App.tsx` (barra superior y tarjetas), `MarketPanel.tsx` |
| Miniaturas de terreno UI (`0701–0707`) | `0701–0707` | `256 × 256` | `28 × 28 px` (leyenda) – `64 × 64 px` (inspector) | `MapPanel.tsx` |
| Sprites hexagonales mapa (`0708–0716`) | `0708–0716` | `256 × 296` | Variable por zoom (`12 px` – `140 px`) en `<canvas>` | `src/map/terrainVisuals.ts`, `src/map/mapRenderer.ts` |
| Marcadores cartográficos (`0717–0720`) | `0717–0720` | `256 × 256` | `24 × 24 px` – `36 × 36 px` | `MapPanel.tsx`, `mapRenderer.ts` |
| Equipo, rangos, doctrinas, misiones (`0801–0833`) | `0801–0833` | `256 × 256` | `32 × 32 px` – `48 × 48 px` | `ArmyPanel.tsx`, `MissionsPanel.tsx`, `ParliamentPanel.tsx`, `App.tsx` |
| Pantallas y escudo del juego (`0834–0836`) | `0834–0836` | `1280 × 720` (`0834–0835`), `256 × 256` (`0836`) | Full bleed / banner / favicon | `HomeScreen.tsx`, `FoundingWizard.tsx`, `index.html` |
| Retratos de monarcas bots (`0840–0886`) | `0840–0886` | `256 × 256` | `40 × 40 px` – `56 × 56 px` (`rounded-full`/`rounded-lg`) | `ParliamentPanel.tsx` |

---

## 4. Reglas de nomenclatura e identificadores numéricos

1. **Identificador numérico global (`ID`):** Entero de 4 dígitos con relleno de ceros a la izquierda (`0001` a `0999`), único, permanente e inmutable. Nunca se reutiliza un ID si un elemento se retira en el futuro.
2. **Rangos reservados por categoría:**
   - `0001–0099`: Edificios (base y variantes culturales únicas).
   - `0100–0199`: Civilizaciones, escudos y emblemas.
   - `0200–0399`: Tropas, espías, mercenarios y maquinaria de asedio.
   - `0400–0599`: Tecnologías e investigaciones (`0401–0591` asignados a las 191 tecnologías reales).
   - `0600–0699`: Recursos, bienes, métricas y estaciones.
   - `0700–0799`: Terrenos, sprites hexagonales y cartografía.
   - `0800–0999`: Misiones, recompensas, equipo, rangos, doctrinas, políticas, pantallas, escudo oficial y retratos de monarcas bots.
3. **Formato estricto de nombre de archivo:**  
   `^[0-9]{4}_[a-z0-9_]+\.webp$`  
   - Solo minúsculas ASCII (`a-z`), dígitos (`0-9`) y guion bajo (`_`).
   - Prohibidos espacios, tildes (`áéíóú`), `ñ`, diéresis o caracteres especiales.
   - Sufijo de variante (cuando exista, ej. terrenos de mapa): `0708_hex_llanura_v0.webp`, `0708_hex_llanura_v1.webp`, `0708_hex_llanura_v2.webp`.

---

## 5. Jerarquía de directorios recomendada en `public/assets/game/`

Al iniciar la fase de producción e integración, los archivos finales se ubicarán bajo `/public/assets/game/` para servirse de forma estática por Vite sin penalizar el *bundle* JavaScript inicial:

```text
public/assets/game/
├── manifest.json                 # Índice máquina-legible ID -> ruta, tamaño, variantes y fallback
├── buildings/                    # 0001–0030
├── civilizations/                # 0101–0113
├── units/                        # 0201–0269
├── technologies/                 # 0401–0591
├── resources/                    # 0601–0618
├── terrains/                     # 0701–0720 (+ variantes *_v0.webp, *_v1.webp, *_v2.webp)
├── ui/                           # 0801–0836 (equipo, rangos, doctrinas, misiones, pantallas)
└── portraits/                    # 0840–0886 (47 monarcas bots de botConfig.ts)
```

---

## 6. Arquitectura de carga segura, caché y *fallback*

1. **Carga diferida (*lazy loading*) en DOM:** Toda miniatura fuera del pliegue inicial usará `loading="lazy"` y `decoding="async"`, con atributos explícitos `width` y `height` para evitar *Cumulative Layout Shift* (CLS).
2. **Resolución y respaldo seguro (`GameThumbnail` futuro):**
   - Si un archivo `.webp` todavía está en estado `pendiente de producir` o falla al cargar (`onError`), el componente debe degradar silenciosamente al icono `lucide-react`, emoji actual o vector CSS sin mostrar iconos rotos (`broken image`) ni lanzar errores no capturados.
   - Para edificios únicos de civilización (`0019–0030`), si falta la variante cultural, el *resolver* caerá automáticamente al edificio base (`0001–0018`).
   - Para unidades culturales (`0201–0248`), si falta la variante de una civilización, caerá a su unidad base universal (`0249–0252`).
3. **Integración en Canvas 2D (`TerrainAssetProvider` en `src/map/terrainVisuals.ts`):**
   - `TerrainAssetProvider` ya contempla `getTerrainSprite(terrain, variant, lod)` y `getCapitalSprite(isOwnCapital, lod)` devolviendo `null` cuando no hay sprite cargado, momento en el que `TerrainStampCache` ejecuta el renderizado vectorial procedural (`drawIllustratedTerrainHex`, `drawMedievalCapitalFortress`, `drawFogHex`).
   - Al incorporar `0708–0716`, se cargarán de forma asíncrona como `ImageBitmap` / `HTMLImageElement` y dispararán la invalidación controlada de `TerrainStampCache` conforme queden listos.

---

## 7. Prioridades de producción por lotes

| Prioridad | Criterio | Alcance |
|---|---|---|
| **P0 — Crítica** | Identidad inicial del juego, recursos siempre visibles, edificios principales, terrenos del mapa y 4 armas base | `0001–0018`, `0101–0112`, `0249–0253`, `0601–0605`, `0701–0716`, `0834`, `0836` |
| **P1 — Alta** | Unidades culturales clave, mercenarios, equipamiento de combate, rangos militares, misiones de etapas y tecnologías nivel 1–2 | `0201–0248`, `0264–0269`, `0401–0591` (nivel 1–2 y exclusivas base), `0801–0833`, `0840–0844` |
| **P2 — Media** | Resto de tecnologías universales y exclusivas (niveles 3–8), maquinaria especializada de asedio, variantes arquitectónicas únicas, overlays cartográficos y bots rotatorios | `0019–0030`, `0254–0263`, resto de `0401–0591`, `0606–0618`, `0717–0720`, `0835`, `0845–0886` |
| **P3 — Baja** | Estados secundarios y variaciones estacionales complementarias | `0113` |
