# Auditoría Completa de Imágenes Personalizadas — La Conquista

> **Alcance:** Documento estrictamente de auditoría e inventario técnico. No se ha generado ninguna imagen ni se ha añadido o modificado ningún recurso gráfico en la interfaz de usuario durante esta fase.
>
> **Dirección de arte unificada recomendada:** Óleo digital histórico-medieval oscuro con pátina de pergamino envejecido, iluminación cálida de antorcha/ocaso en contraste con sombras profundas (`#0e0c09` / `#14110d`), detalles metálicos en oro bruñido (`#d4af37`) y bronce, rigor histórico acorde a cada civilización (sin cascos vikingos con cuernos, sin anacronismos de pólvora donde no corresponde) y ausencia total de texto incrustado salvo en el arte titular de portada.

---

## 1. Inventario actual detectado en el repositorio

Durante la inspección directa de `/public/assets` y `src/`:

| Archivo detectado | Ruta real | Uso actual en UI | Estado |
| :--- | :--- | :--- | :--- |
| Ilustración oficial de portada | `/public/assets/aistudio/1793086836321_852e3733.jpg` | Renderizada en `src/components/HomeScreen.tsx` (escritorio 1264×843 y móvil) | Activo en producción |
| Arquero inglés de arco largo | `/public/assets/images/units/unidad_ingles_arquero_arco_largo.jpg` | **Sin referencias** en `src/` | Asset huérfano sin diccionario ni componente |
| Legionario romano | `/public/assets/images/units/unidad_romana_legionario.png` | **Sin referencias** en `src/` | Asset huérfano sin diccionario ni componente |
| Arte auxiliar de inicio | `/public/assets/inicio_la_conquista_oficial.png`, `/public/assets/aistudio/1793546686336_f642fb4d.jpg`, `/public/assets/aistudio/a_cinematic_high_fantasy_medieval_game_login_intr_097b7d22.png`, `/public/assets/aistudio/file_000000005c4c824385c76cdb3b6f7b87_243b6aed.png` | **Sin referencias** en `src/` | Referencias/borradores históricos no montados |

El resto del juego emplea actualmente emojis Unicode (`🏰`, `🏹`, `🪵`, `🪙`, etc.) e iconos vectoriales genéricos de `lucide-react` (`Castle`, `Hammer`, `Swords`, `GraduationCap`, `Landmark`, `Map`, `Coins`, `Wheat`, `Scale`, `Trophy`, etc.), o primitivas `<canvas>` en `MapPanel.tsx`.

---

## 2. Catálogo exhaustivo por categorías (A–H)

Cada activo incluye los **9 campos obligatorios**:
1. **Identificador técnico**
2. **Nombre visible en el juego**
3. **Dónde aparece en la UI**
4. **Tamaño o relación de aspecto recomendada**
5. **Formato recomendado**
6. **Estilo visual coherente con el juego**
7. **Prioridad** (`Alta`, `Media`, `Baja`)
8. **Descripción visual detallada lista para generar el prompt**
9. **Estado actual**

---

### Categoría A — Edificios y Arquitectura del Reino (31 activos)

Incluye los **18 edificios oficiales** (`BUILDINGS` en `convex/balanceConfig.ts`), las **12 variantes singulares por civilización** (`CIVILIZATION_IDENTITIES[civ].uniqueBuilding`) y **1 insignia de Cuadrilla de Obras**.

| Identificador técnico | Nombre visible en el juego | Dónde aparece en la UI | Tamaño / relación | Formato | Estilo visual coherente | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `building.castillo` | Castillo | `BuildingsAndQueue.tsx`, `App.tsx`, `FoundingWizard.tsx` | 256×256 px (1:1) / tarjeta 16:9 | WebP / PNG | Óleo medieval realista, piedra caliza y estandartes dorados | Alta | Fortaleza señorial de piedra tallada al atardecer con torre del homenaje, almenas, puente levadizo y estandarte dorado ondulando bajo luz cálida sobre fondo oscuro `#14110d`. | Usa emoji/Lucide `Castle` |
| `building.viviendas` | Viviendas | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo medieval cálido | Alta | Conjunto de casas medievales de entramado de madera, tejados de pizarra e iluminación cálida en ventanas y chimeneas humeantes al anochecer. | Usa emoji |
| `building.granja` | Granja | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo bucólico dorado | Alta | Campos de trigo dorado, granero de roble, carreta agrícola y molino de madera bajo luz oblicua de amanecer dorado. | Usa emoji |
| `building.aserradero` | Aserradero | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo rústico forestal | Alta | Taller maderero junto a bosque de pinos con rueda hidráulica, troncos apilados y sierra de bastidor de hierro sobre patio de tierra. | Usa emoji |
| `building.cantera` | Cantera | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo pétreo sobrio | Alta | Tajo escalonado de roca gris con grúa de madera de rueda de ardilla, poleas de cáñamo y bloques de sillería recién cortados. | Usa emoji |
| `building.minaHierro` | Mina de hierro | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo oscuro con acentos de brasa | Alta | Bocamina entibada con vigas de roble en ladera rocosa, vagoneta sobre raíles de madera, picos de acero y faroles de aceite cálidos. | Usa emoji |
| `building.minaOro` | Mina de oro | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo contrastado con reflejos áureos | Alta | Galería aurífera excavada con vetas brillantes de oro en cuarzo, artesas de lavado y crisol iluminado por antorchas. | Usa emoji |
| `building.cuartel` | Cuartel/Barracones | `BuildingsAndQueue.tsx`, `App.tsx`, `ArmyPanel.tsx` | 256×256 px (1:1) | WebP | Óleo marcial sobrio | Alta | Patio de armas empedrado con armerías de lanzas y escudos, empalizada de madera y piedra, y pabellón de tropa con estandarte carmesí. | Usa emoji |
| `building.herreria` | Herrería/Forja | `BuildingsAndQueue.tsx`, `App.tsx`, `ArmyPanel.tsx` | 256×256 px (1:1) | WebP | Óleo claroscuro de fragua | Alta | Fragua encendida con chispas incandescentes, yunque de acero bruñido, tenazas, fuelle de cuero y espadas recién templadas sobre soporte. | Usa emoji |
| `building.universidad` | Universidad | `BuildingsAndQueue.tsx`, `UniversityPanel.tsx` | 256×256 px (1:1) | WebP | Óleo erudito y solemne | Alta | Claustro abovedado con vitrales altos, esfera armilar de latón, estanterías de códices iluminados y mesa de cartografía medieval. | Usa Lucide `GraduationCap` |
| `building.murallas` | Murallas | `BuildingsAndQueue.tsx`, `ArmyPanel.tsx` | 256×256 px (1:1) | WebP | Óleo defensivo monumental | Alta | Paño de muralla almenada de gran espesor con matacanes, torreón semicircular, rastrillo de hierro y antorchas nocturnas de guardia. | Usa emoji |
| `building.mercado` | Mercado | `BuildingsAndQueue.tsx`, `MarketPanel.tsx` | 256×256 px (1:1) | WebP | Óleo costumbrista rico en textura | Alta | Plaza porticada medieval con toldos de lona ocre, sacos de grano, barriles sellados, balanza de bronce y carros de mercaderes. | Usa Lucide `Scale` |
| `building.parlamento` | Parlamento | `BuildingsAndQueue.tsx`, `ParliamentPanel.tsx` | 256×256 px (1:1) | WebP | Óleo institucional dorado | Alta | Salón capitular semicircular de piedra y roble tallado con bancadas reales, candelabros de bronce, pergaminos lacrados y trono presidencial. | Usa Lucide `Landmark` |
| `building.hospitalMilitar` | Hospital militar | `BuildingsAndQueue.tsx`, `ArmyPanel.tsx` | 256×256 px (1:1) | WebP | Óleo sereno de enfermería medieval | Media | Pabellón abovedado de piedra blanca con catres ordenados, botica de hierbas medicinales, vendas de lino y cruz hospitalaria sobria. | Usa emoji |
| `building.taberna` | Taberna | `BuildingsAndQueue.tsx`, `ArmyPanel.tsx` | 256×256 px (1:1) | WebP | Óleo cálido de interior nocturno | Media | Posada medieval con rótulo de madera forjada, mesas de roble, jarras de peltre, chimenea encendida y contrato mercenario clavado en viga. | Usa emoji |
| `building.panaderia` | Panadería | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo cálido artesanal | Media | Obrador con horno de ladrillo abovedado al rojo vivo, hogazas doradas de pan en palas de madera y sacos de harina blanca. | Usa emoji |
| `building.iglesia` | Iglesia | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo románico/gótico solemne | Media | Templo de piedra tallada con rosetón iluminado desde dentro, campanario sobrio, atrio y luz dorada atravesando pórtico de arco de medio punto. | Usa emoji |
| `building.circo` | Circo/Feria | `BuildingsAndQueue.tsx`, `App.tsx` | 256×256 px (1:1) | WebP | Óleo festivo de paleta cálida | Media | Palenque de justas y feria real con pabellones de tela heráldica, vallas de madera, banderines dorados y gradas populares. | Usa emoji |
| `building_unique.ingleses.cuartel` | Campo de Tiro (Ingleses) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo histórico inglés s. XIV | Baja | Campo de tiro con dianas de paja trenzada, arcos largos de tejo ingleses en armero y pabellón de madera en campiña brumosa. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.romanos.cuartel` | Castra (Romanos) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo clásico Alto Imperio | Baja | Campamento fortificado romano con foso, empalizada de *pilum*, puertas cardo-decumano y tienda pretoriana con águila imperial dorada. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.griegos.universidad` | Liceo (Griegos) | `FoundingWizard.tsx`, `UniversityPanel.tsx` | 256×256 px (1:1) | WebP | Óleo clásico helénico | Baja | Pórtico de columnas dóricas de mármol cálido, olivos antiguos, rollos de papiro y esferas astronómicas bajo luz mediterránea dorada. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.vikingos.taberna` | Salón Largo (Vikingos) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo nórdico s. IX–X | Baja | Gran salón largo nórdico de madera tallada con dragones geométricos en vigas, hogar central de fuego y escudos redondos lisos colgados. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.bizantinos.circo` | Hipódromo (Bizantinos) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo bizantino monumental | Baja | Arena imperial alargada con espina decorada en mármol y pórfido, obelisco de bronce y palco imperial con mosaico dorado. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.arabes.mercado` | Caravasar (Árabes) | `FoundingWizard.tsx`, `MarketPanel.tsx` | 256×256 px (1:1) | WebP | Óleo islámico clásico s. X | Baja | Patio interior de arcos de herradura en piedra ocre, fuente octogonal central, fardos de seda, especias y camellos descansando bajo linternas. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.mongoles.viviendas` | Ger del Kan (Mongoles) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo estepario s. XIII | Baja | Gran yurta mongola ceremonial de fieltro blanco y ribetes rojos y oro frente a campamento circular de estepa bajo cielo crepuscular. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.chinos.granja` | Arrozal Imperial (Chinos) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo dinastía Song | Baja | Terrazas escalonadas de arroz inundadas reflejando luz dorada del alba, norias de bambú y pabellón agrícola de madera lacada. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.japoneses.herreria` | Herrería del Maestro Forjador (Japoneses) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo periodo Sengoku | Baja | Taller tradicional japonés de madera oscura con horno *tatara* de tamahagane, katana al rojo sobre yunque bajo agua y brasas. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.navajos.taberna` | Hogar de rastreadores (Navajos) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo del Suroeste histórico | Baja | Hoggán octogonal de troncos de cedro y tierra rojiza al pie de cañón rocoso, fuego interior acogedor, arcos de piñón y mantas tejidas. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.aztecas.iglesia` | Templo Mayor (Aztecas) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo mexica s. XV | Baja | Basamento piramidal escalonado de piedra volcánica y estuco blanco con doble escalinata, braseros de copal humeantes y santuarios gemelos. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `building_unique.masais.viviendas` | Boma (Masáis) | `FoundingWizard.tsx`, `BuildingsAndQueue.tsx` | 256×256 px (1:1) | WebP | Óleo de sabana africana | Baja | Recinto circular fortificado con cerca espinosa de acacia, cabañas *enkaji* de adobe bajo sombra dorada de acacias en la sabana. | Solo nombre en `CIVILIZATION_IDENTITIES` |
| `ui.construction_crew` | Cuadrilla de Obras Reales | `BuildingsAndQueue.tsx` | 128×128 px (1:1) | PNG / WebP | Sello ilustrativo en relieve dorado | Baja | Medallón de bronce con martillo de cantero, escuadra de arquitecto y plomada cruzados sobre pergamino oscuro. | Usa Lucide `Hammer` |

**Subtotal Categoría A:** **31 activos** (18 edificios base + 12 edificios singulares de civilización + 1 sello de cuadrilla).

---

### Categoría B — Tropas, Unidades Militares, Mercenarios y Agentes (33 activos)

Incluye las **15 unidades de `UNITS`** (`balanceConfig.ts`: 3 ramas regulares + asedio genérico + 10 máquinas de asedio nominales + 1 agente `espia`), los **6 tipos de mercenarios** (`MERCENARIES.TYPES`) y las **12 tropas características por civilización** (`CIVILIZATION_IDENTITIES[civ].signatureUnit`).

| Identificador técnico | Nombre visible en el juego | Dónde aparece en la UI | Tamaño / relación | Formato | Estilo visual coherente | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `unit.infanteria` | Infantería | `ArmyPanel.tsx`, `TroopSelector.tsx`, `ParliamentPanel.tsx`, `App.tsx` | 256×256 px (1:1) | WebP / PNG | Retrato militar realista al óleo | Alta | Soldado de infantería medieval de medio cuerpo con cota de malla, casco nasal de hierro, lanza alta y escudo cometa apoyado sobre fondo humo de batalla. | Usa Lucide `Shield` / texto |
| `unit.arqueria` | Arquería | `ArmyPanel.tsx`, `TroopSelector.tsx`, `App.tsx` | 256×256 px (1:1) | WebP / PNG | Retrato militar realista al óleo | Alta | Arquero veterano tensando arco de madera curada con carcaj de cuero repleto de flechas emplumadas, capucha de paño y mirada atenta. | Usa Lucide `Target` / texto |
| `unit.caballeria` | Caballería | `ArmyPanel.tsx`, `TroopSelector.tsx`, `App.tsx` | 256×256 px (1:1) | WebP / PNG | Retrato militar realista al óleo | Alta | Jinete acorazado sobre destrero con barda de cuero y hierro, lanza de caballería en ristre y capa ondeante bajo cielo tormentoso. | Usa Lucide `Swords` / texto |
| `unit.asedio` | Asedio genérico | `ArmyPanel.tsx`, `TroopSelector.tsx`, `App.tsx` | 256×256 px (1:1) | WebP / PNG | Ilustración bélica de ingeniería medieval | Alta | Máquina de asedio de madera reforzada con herrajes de hierro negro, contrapesos de piedra y sirvientes cargando proyectiles en penumbra de asedio. | Usa texto / icono |
| `unit.onagro_campana` | Onagro de campaña | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Catapulta de torsión sobre chasis con cuatro ruedas robustas, brazo único tensado con cuerdas de crin y cuchara cargada de piedra. | Sin imagen (texto plano) |
| `unit.carrobalista` | Carrobalista | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Ballesta pesada de torsión montada sobre carro ligero de dos ruedas, arco metálico y dardo pesado de hierro preparado. | Sin imagen (texto plano) |
| `unit.espringarda_movil` | Espringarda móvil | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Bastidor vertical de madera con doble haz de torsión tensando virote de hierro de gran penetración montado en cureña móvil. | Sin imagen (texto plano) |
| `unit.trabuchet_traccion` | Trabuchet de tracción | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Ingenio medieval de palanca basculante con múltiples sogas de tiro manual en abanico y honda de cuero cargada. | Sin imagen (texto plano) |
| `unit.arcuballista` | Arcuballista / manuballista | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Escorpión/manuballista de precisión sobre afuste ligero con manivela de trinquete y miras de latón. | Sin imagen (texto plano) |
| `unit.fustibalo_campo` | Fustíbalo de campo | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Hondero/ingenio ligero de asta de tiro rápido con equipo móvil de campaña para lanzamiento parabólico. | Sin imagen (texto plano) |
| `unit.mangonel_tactico` | Mangonel de ruedas táctico | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Mangonel compacto con caja de contrapeso y ruedas herradas diseñado para despliegue rápido en campo abierto. | Sin imagen (texto plano) |
| `unit.carros_artillados` | Carros de combate artillados | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Carromato blindado de tablones gruesos con troneras laterales, picas defensivas y ballestas fijas en troneras. | Sin imagen (texto plano) |
| `unit.ariete_movil` | Ariete móvil de campo | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Viga maciza con cabeza de carnero de hierro fundido suspendida bajo techo inclinado de cuero húmedo anti-fuego sobre ruedas. | Sin imagen (texto plano) |
| `unit.torres_asalto` | Torres de asalto ligeras | `ArmyPanel.tsx`, `TroopSelector.tsx` | 256×256 px (1:1) | WebP | Óleo técnico histórico | Media | Torre de madera móvil de tres pisos cubierta de pieles crudas con puente abatible en coronación y plataforma de arqueros. | Sin imagen (texto plano) |
| `unit.espia` | Espía | `ArmyPanel.tsx` ("Instrucción de Agentes"), `MapPanel.tsx` (expedición de espionaje), `ParliamentPanel.tsx` | 256×256 px (1:1) | WebP / PNG | Óleo nocturno sigiloso | Alta | Agente encapuchado de capa oscura y jubón de cuero silencioso sosteniendo sello lacrado y catalejo bajo farol atenuado en callejón medieval. | Usa Lucide `Compass` / `Eye` |
| `merc.mesnada_sueldo` | Mesnada a sueldo | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo realista de tropa fronteriza | Media | Peón ibérico de frontera con capellina de acero, lanza corta, rodela y gambesón desgastado de campaña. | Sin imagen (solo texto) |
| `merc.lanceros_sueldo` | Lanceros a sueldo | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo realista de formación cerrada | Media | Piquero/lancero mercenario europeo con gola de acero, pica larga inclinada y sobrevesta bicolor sin blasón dinástico. | Sin imagen (solo texto) |
| `merc.arqueros_fortuna` | Arqueros de fortuna | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo realista de ballesteros/arqueros | Media | Compañía de tiradores mercenarios con ballesta de estribo o arco compuesto, brigantina claveteada y bolsa de monedas al cinto. | Sin imagen (solo texto) |
| `merc.jinetes_fortuna` | Jinetes de fortuna | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo dinámico de caballería ligera | Media | Jinete balcánico *stradioti* con sombrero alto, lanza ligera de fresno, escudo almendrado y caballo nervioso. | Sin imagen (solo texto) |
| `merc.compania_veterana` | Compañía veterana | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo realista de Compañía Blanca | Media | Capitán mercenario curtido con cicatriz en rostro, coraza bruñida de placas, alabarda y estandarte blanco raído. | Sin imagen (solo texto) |
| `merc.guardia_mercenaria` | Guardia mercenaria | `ArmyPanel.tsx` (Taberna / Mercenarios) | 256×256 px (1:1) | WebP | Óleo épico de condottieri | Media | Condottiero italiano en armadura completa de acero milanés montado en corcel acorazado con penacho carmesí y oro. | Sin imagen (solo texto) |
| `sig_unit.ingleses` | Arquero de arco largo | `FoundingWizard.tsx`, `ArmyPanel.tsx`, `ParliamentPanel.tsx` | 512×512 px / 3:4 | JPG / WebP | Óleo histórico realista | Media | *(Ya existe `/public/assets/images/units/unidad_ingles_arquero_arco_largo.jpg`)* — Arquero inglés de tejo largo s. XIV en bosque brumoso. | **Archivo existente sin integrar en UI** |
| `sig_unit.romanos` | Legionario | `FoundingWizard.tsx`, `ArmyPanel.tsx`, `ParliamentPanel.tsx` | 512×512 px / 3:4 | PNG / WebP | Óleo histórico realista | Media | *(Ya existe `/public/assets/images/units/unidad_romana_legionario.png`)* — Legionario romano con *lorica segmentata*, *gladius* y *scutum*. | **Archivo existente sin integrar en UI** |
| `sig_unit.griegos` | Hoplita | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo histórico clásico | Media | Hoplita griego clásico con casco corintio de crin, coraza de bronce, lanza *dory* y gran escudo *hoplon* redondo con emblema geométrico. | Sin imagen |
| `sig_unit.vikingos` | Huscarl | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo nórdico fiel históricamente | Media | Guerrero huscarl nórdico con casco Gjermundbu **sin cuernos**, cota de malla *brynja*, hacha danesa de hoja ancha y escudo redondo de madera pintada. | Sin imagen |
| `sig_unit.bizantinos` | Catafracto | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo bizantino dorado | Media | Jinete catafracto bizantino cubierto de coraza lamelar *klivanion*, casco con aventail de malla, lanza *kontos* y capa púrpura imperial. | Sin imagen |
| `sig_unit.arabes` | Jinete ligero | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 256×256 / 512×512 px | WebP | Óleo del califato medieval | Media | Jinete árabe sobre corcel árabe tordo, turbante blanco con cota oculta, arco compuesto y escudo redondo de cuero endurecido bajo luz cálida del desierto. | Sin imagen |
| `sig_unit.mongoles` | Jinete arquero | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo de estepa s. XIII | Media | Jinete mongol con armadura lamelar lacada, sombrero de piel, disparando arco compuesto hacia atrás a galope tendido sobre estepa dorada. | Sin imagen |
| `sig_unit.chinos` | Ballestero (Song) | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo dinastía Song | Media | Tirador de infantería china Song con armadura lamelar *shanwenjia*, casco de hierro y ballesta de madera lacada y bronce en posición de disparo. | Sin imagen |
| `sig_unit.japoneses` | Samurái | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo periodo Sengoku | Media | Samurái con armadura *dō-maru* negra y cordones dorados, katana y lanza *yari*, con arco *yumi* asimétrico sobre bosque de cedros con niebla. | Sin imagen |
| `sig_unit.navajos` | Rastreador Diné | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo histórico respetuoso | Media | Explorador Diné con túnica de piel de ciervo, arco de piñón y tendón, carcaj a la espalda y mirada alerta en borde de cañón rojizo. | Sin imagen |
| `sig_unit.aztecas` | Guerrero Águila | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo mexica fiel s. XV | Media | Guerrero Águila mexica con *ichcahuipilli* acolchado, yelmo ceremonial de plumas de águila, espada *macuahuitl* de obsidiana y escudo *chimalli*. | Sin imagen |
| `sig_unit.masais` | Guerrero Moran | `FoundingWizard.tsx`, `ArmyPanel.tsx` | 512×512 px (1:1) | WebP | Óleo histórico de sabana | Media | Guerrero Il-Moran masái con *shúkà* carmesí, lanza *ol-alem* de hierro largo y escudo ovalado *el-longo* de piel de búfalo con motivos geométricos. | Sin imagen |

**Subtotal Categoría B:** **33 activos** (15 unidades `UNITS` + 6 mercenarios + 12 tropas singulares; 2 archivos huérfanos detectados).

---

### Categoría C — Civilizaciones, Estandartes y Retratos de Monarcas Bot (59 activos)

Incluye los **12 emblemas/estandartes de las civilizaciones oficiales** (`CIVILIZATIONS` en `balanceConfig.ts`), los **5 retratos de bots permanentes** (`PERMANENT_BOTS` en `botConfig.ts`) y los **42 sellos/retratos de bots rotatorios** (`ROTATING_POOLS` en `botConfig.ts`).

#### C.1 — Emblemas y Estandartes de Civilización (12)

| Identificador técnico | Nombre visible | Dónde aparece en UI | Tamaño | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `civ.ingleses` | Ingleses | `HomeScreen.tsx`, `FoundingWizard.tsx`, `ParliamentPanel.tsx`, `MapPanel.tsx` | 128×128 px (1:1) | WebP / SVG+PNG | Blasón heráldico metálico sobre esmalte oscuro | Alta | Escudo heráldico medieval con tres leones dorados pasantes sobre campo carmesí envejecido, arco largo cruzado detrás y borde de oro bruñido. | Usa emoji `🏹` |
| `civ.romanos` | Romanos | Mismos que arriba | 128×128 px (1:1) | WebP | Relieve de águila imperial en bronce/oro | Alta | Águila legionaria romana (*aquila*) de oro sobre corona de laurel y estandarte púrpura imperial SPQR estilizado sin letras modernas. | Usa emoji `🏛️` |
| `civ.griegos` | Griegos | Mismos que arriba | 128×128 px (1:1) | WebP | Bronce antiguo y terracota ateniense | Alta | Mochuelo sabio y yelmo corintio en bajorrelieve dorado dentro de escudo circular hoplita con greca helénica perimetral. | Usa emoji `🏺` |
| `civ.vikingos` | Vikingos | Mismos que arriba | 128×128 px (1:1) | WebP | Talla en madera oscura y hierro nórdico | Alta | Proa de drakkar y nudo entretejido estilo Borre en hierro forjado y oro sobre escudo redondo de roble azulado. | Usa emoji `⚔️` / `🪓` |
| `civ.bizantinos` | Bizantinos | Mismos que arriba | 128×128 px (1:1) | WebP | Mosaico bizantino oro y púrpura | Alta | Águila bicéfala imperial de oro sobre fondo púrpura de Tiro con filigrana esmaltada y corona basílica bizantina. | Usa emoji `🛡️` / `👑` |
| `civ.arabes` | Árabes | Mismos que arriba | 128×128 px (1:1) | WebP | Geometría islámica en oro y lapislázuli | Alta | Estrella octogonal geométrica (*Rub el Hizb*) en oro filigranado sobre esmalte verde esmeralda oscuro y creciente estilizado. | Usa emoji `🌙` / `🐎` |
| `civ.mongoles` | Mongoles | Mismos que arriba | 128×128 px (1:1) | WebP | Bronce estepario y crin ceremonial | Alta | Estandarte *Tug* con crines blancas, sol y luna crecientes en oro batido y dos arcos compuestos cruzados sobre cuero negro. | Usa emoji `🐎` / `🏹` |
| `civ.chinos` | Chinos | Mismos que arriba | 128×128 px (1:1) | WebP | Laca carmesí imperial y jade/oro Song | Alta | Dragón imperial chino enrollado en relieve dorado sobre medallón circular de laca roja y jade oscuro. | Usa emoji `🏮` / `🏯` |
| `civ.japoneses` | Japoneses | Mismos que arriba | 128×128 px (1:1) | WebP | Mon heráldico japonés en laca negra y oro | Alta | Emblema *Kamon* dorado minimalista con abanico de guerra *tessen* y hojas de katana cruzadas sobre laca negra *urushi*. | Usa emoji `⛩️` / `⚔️` |
| `civ.navajos` | Navajos | Mismos que arriba | 128×128 px (1:1) | WebP | Plata turquesa y ocre del Suroeste | Alta | Medallón geométrico de águila y cuatro direcciones sagradas en turquesa natural, plata labrada y arenisca roja. | Usa emoji `🦅` |
| `civ.aztecas` | Aztecas | Mismos que arriba | 128×128 px (1:1) | WebP | Piedra del Sol, oro y jade mexica | Alta | Disco solar mexica tallado en oro y jade verde quetzal con águila solar estilizada y motivos de plumas preciosas. | Usa emoji `☀️` |
| `civ.masais` | Masáis | Mismos que arriba | 128×128 px (1:1) | WebP | Cuero labrado ocre, carmesí y ébano | Alta | Escudo ovalado masái *el-longo* dividido en negro, rojo ocre y blanco con dos lanzas *ol-alem* cruzadas detrás. | Usa emoji `🌾` / `🦁` |

#### C.2 — Bots Permanentes del Parlamento (5)

| Identificador técnico | Nombre visible en el juego | Dónde aparece | Tamaño | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `bot.bot_perm_narbona` | Narbona (Fácil · Navajos) | `ParliamentPanel.tsx` | 160×160 px (1:1) | WebP | Retrato al óleo histórico digno | Media | Retrato de jefe tradicional navajo anciano con banda frontal, collar de turquesas y cañón rojo detrás en luz crepuscular. | Sin imagen (solo tarjeta texto) |
| `bot.bot_perm_alfredo` | Alfredo el Grande (Media · Ingleses) | `ParliamentPanel.tsx` | 160×160 px (1:1) | WebP | Retrato regio altomedieval al óleo | Media | Monarca anglosajón con barba cuidada, corona de oro sencilla, túnica azul y manuscrito real en sala de piedra. | Sin imagen |
| `bot.bot_perm_leonidas` | Leónidas I (Difícil · Griegos) | `ParliamentPanel.tsx` | 160×160 px (1:1) | WebP | Retrato heroico clásico al óleo | Media | Rey espartano barbado con clámide roja desgastada, coraza de bronce y casco corintio bajo el brazo ante desfiladero rocoso. | Sin imagen |
| `bot.bot_perm_saladino` | Saladino (Muy difícil · Árabes) | `ParliamentPanel.tsx` | 160×160 px (1:1) | WebP | Retrato histórico cortesano al óleo | Media | Sultán ayubí sereno con turbante oscuro, cota fina bajo caftán bordado en oro y estandarte amarillo al fondo. | Sin imagen |
| `bot.bot_perm_julio_cesar` | Julio César (Extrema · Romanos) | `ParliamentPanel.tsx` | 160×160 px (1:1) | WebP | Retrato imperial romano al óleo | Media | General romano de rasgos firmes con corona de laurel dorada, paludamentum púrpura sobre coraza anatómica de bronce. | Sin imagen |

#### C.3 — Bots Rotatorios Semanales del Parlamento (42)

*Todos aparecen en `ParliamentPanel.tsx` (160×160 px 1:1, WebP, óleo de retrato histórico medieval/clásico oscuro, prioridad Baja, estado actual: sin imagen).*

| Identificador técnico | Nombre visible | Civilización / Dificultad | Descripción visual resumida para prompt |
| :--- | :--- | :--- | :--- |
| `bot.bot_rot_harald_diente_azul` | Harald Diente Azul | Vikingos · Fácil | Rey danés s. X con túnica de lana azul, broche de plata y hacha de cuello |
| `bot.bot_rot_taizu_song` | Taizu de Song | Chinos · Fácil | Fundador Song con gorro *futou* imperial y túnica amarilla oficial |
| `bot.bot_rot_minamoto` | Minamoto no Yoritomo | Japoneses · Fácil | Shōgun de Kamakura en traje *sokutai* negro ceremonial con abanico |
| `bot.bot_rot_ganado_mucho` | Ganado Mucho | Navajos · Fácil | Líder de paz Diné con manta rayada tradicional y joyas de plata |
| `bot.bot_rot_acamapichtli` | Acamapichtli | Aztecas · Fácil | Primer *tlatoani* mexica con diadema turquesa *xiuhuitzolli* y manto blanco |
| `bot.bot_rot_mbatian` | Mbatian | Masáis · Fácil | Gran *Oloiboni* anciano con manto oscuro, bastón tallado y sabana al alba |
| `bot.bot_rot_augusto` | Augusto | Romanos · Fácil | Emperador joven con toga praetexta y coraza Prima Porta |
| `bot.bot_rot_alejo_comneno` | Alejo I Comneno | Bizantinos · Fácil | Emperador comneno barbado con clámide bordada y corona *kamelaukion* |
| `bot.bot_rot_canuto` | Canuto el Grande | Vikingos · Media | Rey anglo-danés coronado con capa de pieles y cota de malla |
| `bot.bot_rot_taizong_tang` | Taizong de Tang | Chinos · Media | Emperador guerrero Tang con bigote fino, armadura dorada y arco |
| `bot.bot_rot_ashikaga` | Ashikaga Yoshimitsu | Japoneses · Media | Tercer shōgun Ashikaga con seda brocada dorada ante pabellón dorado |
| `bot.bot_rot_barboncito` | Barboncito | Navajos · Media | Estratega Diné frente a pared roja del Cañón de Chelly |
| `bot.bot_rot_itzcoatl` | Itzcóatl | Aztecas · Media | Tlatoani conquistador con tilmatli bordada de jade y escudo *chimalli* |
| `bot.bot_rot_senteu` | Senteu | Masáis · Media | Caudillo guerrero masái con lanza larga y penacho ceremonial |
| `bot.bot_rot_trajano` | Trajano | Romanos · Media | Emperador militar con coraza de campaña sobre el Danubio |
| `bot.bot_rot_justiniano` | Justiniano I | Bizantinos · Media | Emperador con diadema de perlas imperiales y fondo de mosaico áureo |
| `bot.bot_rot_harun_rashid` | Harún al-Rashid | Árabes · Media | Califa abasí con túnica negra de Bagdad y ribetes dorados |
| `bot.bot_rot_guillermo` | Guillermo el Conquistador | Ingleses · Difícil | Duque normando con cota de malla completa, yelmo nasal y estandarte |
| `bot.bot_rot_filipo_ii` | Filipo II | Griegos · Difícil | Rey macedonio con cicatriz en ojo, diadema de oro y coraza de hierro |
| `bot.bot_rot_harald_hardrada` | Harald Hardrada | Vikingos · Difícil | Gigante nórdico varego con espada larga y cota de malla bizantina |
| `bot.bot_rot_niceforo_focas` | Nicéforo II Focas | Bizantinos · Difícil | General-emperador ascético en coraza lamelar de campaña |
| `bot.bot_rot_abd_al_malik` | Abd al-Malik | Árabes · Difícil | Califa omeya de Damasco con manto blanco y sello real |
| `bot.bot_rot_ogedei` | Ögedei Kan | Mongoles · Difícil | Gran Kan con sombrero cónico forrado en marta y seda dorada |
| `bot.bot_rot_wu_han` | Wu de Han | Chinos · Difícil | Emperador marcial Han con corona de cuentas *mianliu* y jade |
| `bot.bot_rot_manuelito` | Manuelito | Navajos · Difícil | Líder militar Diné de porte firme con banda roja y rifle/arco histórico |
| `bot.bot_rot_lenana` | Lenana | Masáis · Difícil | Oloiboni supremo con adornos de cuentas y collar ceremonial |
| `bot.bot_rot_ricardo_corazon_leon` | Ricardo Corazón de León | Ingleses · Muy difícil | Rey cruzado con sobrevesta roja de tres leones y gran espada |
| `bot.bot_rot_aureliano` | Aureliano | Romanos · Muy difícil | *Restitutor Orbis* con máscara/casco de caballería romano tardío y púrpura |
| `bot.bot_rot_pirro` | Pirro de Epiro | Griegos · Muy difícil | Rey helenístico con casco crestado de bronce y capa escarlata |
| `bot.bot_rot_ragnar` | Ragnar Lodbrok | Vikingos · Muy difícil | Caudillo nórdico de barba trenzada, pieles de lobo y escudo gastado |
| `bot.bot_rot_basilio_ii` | Basilio II | Bizantinos · Muy difícil | Emperador veterano con corona militar, espada y armadura dorada |
| `bot.bot_rot_baybars` | Baybars | Árabes · Muy difícil | Sultán mameluco con casco cónico de acero damasquino y cota |
| `bot.bot_rot_batu_kan` | Batu Kan | Mongoles · Muy difícil | Fundador de la Horda de Oro en armadura lamelar dorada sobre estepa nevada |
| `bot.bot_rot_ahuitzotl` | Ahuítzotl | Aztecas · Muy difícil | Tlatoani en atuendo completo de guerra imperial con penacho de quetzal |
| `bot.bot_rot_enrique_v` | Enrique V | Ingleses · Extrema | Rey de Azincourt con perfil coronado sobre armadura gótica completa |
| `bot.bot_rot_alejandro_magno` | Alejandro Magno | Griegos · Extrema | Conquistador macedonio con coraza de lino y bronce y capa púrpura |
| `bot.bot_rot_gengis_kan` | Gengis Kan | Mongoles · Extrema | Gran Kan de mirada severa, armadura negra lacada y pieles bajo cielo tormentoso |
| `bot.bot_rot_kublai_kan` | Kublai Kan | Mongoles · Extrema | Emperador Yuan en túnica imperial de seda dorada con ribete de armiño |
| `bot.bot_rot_qin_shi_huang` | Qin Shi Huang | Chinos · Extrema | Primer Emperador con túnica imperial negra y oro y corona *mian* ceremonial |
| `bot.bot_rot_oda_nobunaga` | Oda Nobunaga | Japoneses · Extrema | Unificador Sengoku con armadura *nanban-dō* oscura y capa roja europea |
| `bot.bot_rot_toyotomi` | Toyotomi Hideyoshi | Japoneses · Extrema | Gran *Taikō* con yelmo dorado de rayos solares *kabuto* y abanico de mando |
| `bot.bot_rot_moctezuma_ii` | Moctezuma Xocoyotzin | Aztecas · Extrema | Soberano mexica con manto imperial turquesa y gran penacho de plumas verdes |

**Subtotal Categoría C:** **59 activos** (12 emblemas de civilización + 5 bots permanentes + 42 bots rotatorios).

---

### Categoría D — Mapa, Terrenos, Biomas y Marcadores Cartográficos (14 activos)

Incluye los **6 tipos de terreno oficiales** (`TERRAINS`), **1 textura de niebla de guerra** y **7 marcadores/tokens tácticos** usados en el renderizador `<canvas>` de `src/components/MapPanel.tsx`.

| Identificador técnico | Nombre visible en el juego | Dónde aparece en UI | Tamaño / relación | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `terrain.llanura` | Llanura | `MapPanel.tsx` (celda canvas + ficha lateral) | Tile 128×128 px / banner 16:9 | WebP / PNG | Cartografía topográfica medieval iluminada en tonos pergamino y oliva | Alta | Pradera ondulada dorada y verde oliva vista en perspectiva cenital de mapa antiguo iluminado con senderos suaves. | Color sólido `#3d5a2b` en `<canvas>` |
| `terrain.bosque` | Bosque | `MapPanel.tsx` | Tile 128×128 px / 16:9 | WebP / PNG | Cartografía medieval topográfica | Alta | Densa masa arbórea de robles y pinos verde profundo con copas iluminadas en ángulo cenital al estilo de atlas medieval pintado. | Color sólido `#234224` en `<canvas>` |
| `terrain.colina` | Colina | `MapPanel.tsx` | Tile 128×128 px / 16:9 | WebP / PNG | Cartografía medieval topográfica | Alta | Lomadas ocres y verde seco con afloramientos calizos sombreados en relieve cartográfico de mapa antiguo. | Color sólido `#75683d` en `<canvas>` |
| `terrain.montana` | Montaña | `MapPanel.tsx` | Tile 128×128 px / 16:9 | WebP / PNG | Cartografía medieval topográfica | Alta | Cumbres escarpadas de granito gris con nieve leve en crestas y sombreado de ladera al estilo portulano/mapa de estrategia. | Color sólido `#585551` en `<canvas>` |
| `terrain.rio` | Río | `MapPanel.tsx` | Tile 128×128 px / 16:9 | WebP / PNG | Cartografía medieval topográfica | Alta | Valle fluvial sinuoso de aguas azul cobalto oscuro entre riberas fértiles verdes con reflejos dorados suaves. | Color sólido `#25537a` en `<canvas>` |
| `terrain.costa` | Costa | `MapPanel.tsx` | Tile 128×128 px / 16:9 | WebP / PNG | Cartografía medieval topográfica | Alta | Litoral acantilado y playa de arena pálida junto a aguas turquesa oscuro con olas grabadas al estilo portulano medieval. | Color sólido `#2e6e72` en `<canvas>` |
| `terrain.desconocido` | Territorio desconocido (Niebla) | `MapPanel.tsx` | Tile 128×128 px sin costuras | PNG / WebP | Pergamino carbonizado / bruma cartográfica | Media | Textura sutil de niebla de guerra en sepia muy oscuro (`#181410`) con tenues trazos de rosa de los vientos borrosa y nubes tenues. | Color sólido `#181410` |
| `map_marker.capital_propia` | Capital propia | `MapPanel.tsx` (canvas + inspector) | 64×64 px (1:1 transparente) | PNG / SVG | Sello dorado en relieve | Alta | Corona real dorada de cinco puntas en bronce pulido con gema esmeralda central y contorno oscuro nítido para lectura a escala pequeña. | Texto/glyph `👑` |
| `map_marker.territorio_propio` | Provincia propia | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Torreón heráldico | Alta | Torre almenada verde esmeralda y oro bruñido de trazo limpio legible a zoom táctico medio. | Texto/glyph `♜` |
| `map_marker.capital_rival` | Capital rival | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Estandarte carmesí | Media | Fortaleza carmesí coronada con pendón rojo oscuro y borde dorado para distinguir reinos rivales en el mapa. | Texto/glyph `⚑` |
| `map_marker.territorio_rival` | Territorio rival | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Banderín carmesí | Media | Banderín triangular rojo oscuro sobre mástil de hierro para territorios ocupados por adversarios. | Texto/glyph `⚑` |
| `map_marker.expedicion_exploracion` | Expedición de exploración | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Brújula de bronce | Media | Brújula náutica antigua de latón y aguja dorada con brillo cian tenue sobre mapa estratégico. | Texto/glyph `🧭` |
| `map_marker.expedicion_espia` | Expedición de espionaje | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Catalejo y capucha | Media | Catalejo dorado cruzado sobre silueta de capucha violeta oscuro con borde nítido para misiones de inteligencia. | Texto/glyph `🔭` |
| `map_marker.marcha_militar` | Marcha militar / conquista | `MapPanel.tsx` | 64×64 px transparente | PNG / SVG | Espadas cruzadas y pendón | Alta | Dos espadas medievales cruzadas frente a estandarte dorado/rojo para indicar columnas militares en tránsito sobre el tablero hexagonal. | Texto/glyph `⚔️` / `🏰` |

**Subtotal Categoría D:** **14 activos** (6 terrenos + 1 niebla de guerra + 7 marcadores de mapa).

---

### Categoría E — Tecnologías e Investigación (140 activos)

Incluye **5 emblemas de rama tecnológica** (`economica`, `civil`, `militar`, `inteligencia`, `civilizacion`) y las **135 tecnologías oficiales** del catálogo `TECHNOLOGIES` (`convex/balanceConfig.ts`), mostradas en `src/components/UniversityPanel.tsx` (actualmente solo con icono `BookOpen` genérico para todas).

#### E.1 — Emblemas de Rama Tecnológica (5)

| Identificador técnico | Nombre visible | Dónde aparece | Tamaño | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `tech_branch.economica` | Rama Económica | `UniversityPanel.tsx` | 96×96 px | WebP / SVG | Sello medieval dorado | Media | Balanza comercial de latón, espiga de trigo y moneda de oro grabados en medallón de bronce oscuro. | Usa Lucide `BookOpen` |
| `tech_branch.civil` | Rama Civil | `UniversityPanel.tsx` | 96×96 px | WebP / SVG | Sello medieval dorado | Media | Compás de arquitecto medieval, arco de piedra y códice abierto grabados en medallón de piedra y oro. | Usa Lucide `BookOpen` |
| `tech_branch.militar` | Rama Militar | `UniversityPanel.tsx` | 96×96 px | WebP / SVG | Sello medieval dorado | Media | Yunque templado, espada de acero y yelmo cerrado en bajorrelieve de acero y oro. | Usa Lucide `BookOpen` |
| `tech_branch.inteligencia` | Rama Inteligencia | `UniversityPanel.tsx` | 96×96 px | WebP / SVG | Sello medieval dorado | Media | Llave maestra de hierro, pergamino cifrado con lacre y ojo estilizado en disco de obsidiana y oro. | Usa Lucide `BookOpen` |
| `tech_branch.civilizacion` | Rama Civilización | `UniversityPanel.tsx` | 96×96 px | WebP / SVG | Sello medieval dorado | Media | Corona imperial entre ramas de laurel sobre astrolabio dorado en medallón de gala. | Usa Lucide `BookOpen` |

#### E.2 — Rama Económica (26 tecnologías)

*Todas en `UniversityPanel.tsx`, formato 96×96 px (1:1) WebP, estilo ilustración de grabado iluminado/óleo de manuscrito medieval sobre fondo pergamino oscuro `#18140f`, prioridad Baja, estado actual: sin icono propio.*

| Identificador técnico | Nombre visible en el juego | Prompt visual conciso y específico |
| :--- | :--- | :--- |
| `tech.agri_1` | Rotación de cultivos | Parcelas agrícolas divididas en tres hojas con espigas doradas y arado en diagrama iluminado |
| `tech.agri_2` | Arado de vertedera de hierro | Reja y vertedera de hierro forjado brillante abriendo surco de tierra fértil |
| `tech.agri_3` | Acequias y molinos hidráulicos | Rueda hidráulica de roble movida por acequia de piedra junto a molino harinero |
| `tech.agri_4` | Barbecho trienal y abonado | Tres campos concéntricos (siembra, pasto y barbecho) con carros de abono |
| `tech.agri_5` | Molinos de viento y hornos comunales | Molino de torre de piedra con aspas de lona al atardecer y horno humeante |
| `tech.agri_6` | Pósitos y graneros comunales | Granero elevado de madera sellada con sacos de grano atados y llave de hierro |
| `tech.agri_7` | Rotación de cuatro hojas | Cuadrícula de cuatro cultivos variados (trigo, nabo, cebada, trébol) en códice |
| `tech.agri_8` | Tratado de agronomía | Libro abierto de botánica agrícola medieval con pluma de ganso y tintero dorado |
| `tech.mining_1` | Herramientas mineras de hierro | Pico de minero, cuña y maza de hierro cruzadas frente a lámpara de aceite |
| `tech.mining_2` | Lavaderos de mineral y desmonte | Canaleta de madera con corriente de agua separando mena metálica brillante |
| `tech.mining_3` | Entibado de galerías | Túnel subterráneo reforzado con marcos de troncos de roble ensamblados |
| `tech.mining_4` | Aserraderos de sierra hidráulica | Hoja de sierra vertical accionada por engranajes de madera cortando viga |
| `tech.mining_5` | Canteras de cuña y talla | Bloque de granito partido con hileras de cuñas de hierro y mazo de cantero |
| `tech.mining_6` | Altos hornos de fundición | Horno vertical de ladrillo refractario vertiendo hierro líquido incandescente |
| `tech.mining_7` | Filones de oro y lavado aurífero | Batea minera con pepitas de oro relucientes bajo chorro de agua |
| `tech.mining_8` | Gremios de mineros y canteros | Escudo gremial con picos y escuadra de cantero dorados sobre pergamino |
| `tech.mining_9` | Cecas y orfebrería real | Troquel de hierro acuñando monedas de oro reales sobre yunque pequeño |
| `tech.storage_1` | Almacenes reforzados | Arcón y bodega con cinchos de hierro negro y candado reforzado |
| `tech.storage_2` | Silos y bodegas subterráneas | Cripta abovedada de piedra fresca llena de tinajas selladas y toneles |
| `tech.storage_3` | Reservas de guerra | Carreta de víveres sellada y cajas de provisiones marcadas con emblema real |
| `tech.trade_1` | Estándar real de pesos y medidas | Juego de pesas de bronce calibradas junto a vara real de medir |
| `tech.trade_2` | Ferias y caravanas regulares | Caravana de mulas y carromatos con toldos caminando hacia ciudad amurallada |
| `tech.trade_3` | Lonjas y letras de cambio | Pergamino bancario con sello de lacre rojo, pluma y bolsa de cuero con oro |
| `tech.trade_4` | Banca de los gremios | Mesa de cambista medieval con balanza de precisión y pilas de florines |
| `tech.merc_1` | Contratas y capitanes de compañía | Contrato militar enrollado junto a espada corta y bolsa de soldada |
| `tech.merc_2` | Compañías libres | Estandarte blanco desplegado con grupo de picas, escudos y monedas de oro |

#### E.3 — Rama Civil (21 tecnologías)

*Mismas especificaciones base que E.2 (`UniversityPanel.tsx`, 96×96 px, WebP, grabado/óleo medieval oscuro, prioridad Baja).*

| Identificador técnico | Nombre visible | Prompt visual específico |
| :--- | :--- | :--- |
| `tech.construction_1` | Cantería de sillería | Sillares escuadrados encajando con precisión junto a cincel y maceta |
| `tech.construction_2` | Grúas de rueda de ardilla | Grúa medieval de gran rueda de madera izando bloque de piedra |
| `tech.construction_3` | Andamios y maestros de obra | Andamiaje de madera atado con sogas en muro de torre en construcción |
| `tech.construction_4` | Arbotantes y contrafuertes | Arbotantes góticos de piedra sosteniendo bóveda alta |
| `tech.construction_5` | Encofrados y mortero hidráulico | Cimbra de madera y paleta de albañil aplicando mortero blanco |
| `tech.construction_6` | Maestros de cantería y gremios | Compás de oro, regla graduada y nivel triangular de plomada |
| `tech.construction_7` | Arquitectura monumental de fábrica | Catedral o palacio de piedra monumental con grandes arcos y agujas |
| `tech.construction_8` | Obra maestra del reino | Gran maqueta arquitectónica en madera y piedra sobre mesa de maestro |
| `tech.educ_1` | Tratados escolásticos y trivium | Tres volúmenes encuadernados en piel y latón con cinta marcadora |
| `tech.educ_2` | Quadrivium y cátedras reales | Esfera armilar, compás musical y pergaminos geométricos |
| `tech.educ_3` | Bibliotecas monacales y cartularios | Atril de madera tallada iluminado por vela con gran códice encadenado |
| `tech.educ_4` | Academia de ciencias reales | Telescopio temprano de latón, astrolabio y planos estelares |
| `tech.educ_5` | Ingeniería y mecánica | Ruedas dentadas de madera y bronce conectadas a tornillo sin fin |
| `tech.educ_6` | Sabios y consejeros del reino | Mesa de consejo erudita con mapas, astrolabio y sellos reales |
| `tech.happiness_1` | Fiestas y ferias comunales | Banderines coloridos, laúd medieval y mesa con pan y fruta |
| `tech.happiness_2` | Fueros de villa y gremios | Carta puebla desplegada con gran sello real colgante de cera |
| `tech.happiness_3` | Capellanes de campaña y misas de leva | Cruz procesional sencilla de bronce junto a estandarte de campaña |
| `tech.happiness_4` | Justas, circo y festejos | Lanzas de justa cruzadas con listones y tienda de torneo heráldica |
| `tech.happiness_5` | Exención de cargas y patronato | Balanza equilibrada con ramo de olivo dorado y arca abierta |
| `tech.happiness_6` | Cofradías y fiestas patronales | Faroles encendidos y estandarte gremial bordado en oro y azul |
| `tech.happiness_7` | Edad de oro del reino | Corona radiante sobre ciudad próspera iluminada por sol dorado |

#### E.4 — Rama Militar (32 tecnologías)

*Mismas especificaciones base que E.2 (`UniversityPanel.tsx`, 96×96 px, WebP, óleo militar sobre fondo oscuro, prioridad Baja).*

| Identificador técnico | Nombre visible | Prompt visual específico |
| :--- | :--- | :--- |
| `tech.training_1` | Doctrina de instrucción de levas | Siluetas tácticas de lanceros en formación frente a maniquí de práctica |
| `tech.training_2` | Ordenanzas de regimiento | Pergamino reglamentario con estandarte y lanzas alineadas en orden cerrado |
| `tech.training_3` | Campos de instrucción permanentes | Empalizada de campo de entrenamiento con dianas, vallas y armas de madera |
| `tech.training_4` | Disciplina y ordenanza de hierro | Casco cerrado de hierro y escudos trabados en muro infranqueable |
| `tech.training_5` | Academia militar | Maqueta de tablero de batalla con fichas talladas de infantería y caballería |
| `tech.medicine_1` | Cataplasmas y huertos medicinales | Mortero de piedra, hierbas secas curativas y frascos de ungüento |
| `tech.medicine_2` | Ambulancias de carro y hospicio de campaña | Carro cubierto de lona blanca con farol y botiquín de madera |
| `tech.medical_2` | Cirugía de campaña y triaje | Instrumental quirúrgico limpio de hierro y vendajes de lino enrollados |
| `tech.medicine_3` | Herboristería y boticas | Estantería boticaria con tarros de cerámica y alambique de cobre |
| `tech.medical_3` | Cirugía de guerra y vino antiséptico | Ánfora de vino, vendas limpias y cauterio al fuego sobre bandeja |
| `tech.medical_4` | Letrinas, baños y aseo de campamento | Canalización limpia de piedra en campamento ordenado con barriles de agua |
| `tech.medical_5` | Orden de caballeros hospitalarios | Capa oscura con cruz hospitalaria de ocho puntas sobre escudo blanco |
| `tech.weapons_1` | Metalurgia del acero | Lingote de acero chispeante y espada templada junto a martillo de forja |
| `tech.armor_1` | Armaduras de hierro y malla | Cota de malla tejida anillo a anillo con alicates y peto de hierro |
| `tech.advanced_steel` | Acero al crisol y caldeado | Crisol incandescente vertiendo acero refinado con vetas de damasco |
| `tech.forge_2` | Templado y revenido | Hoja al rojo vivo sumergiéndose en cuba de aceite con nube de vapor |
| `tech.forge_3` | Cotas de malla y escudos reforzados | Escudo herrado con umbo de acero remachado sobre malla fina |
| `tech.forge_4` | Aceros de crisol refinado | Espada maestra reluciente con reflejos azulados de temple perfecto |
| `tech.forge_5` | Armaduras de placas articuladas | Guantelete y hombrera articulada de acero pulido con remaches dorados |
| `tech.logistics_1` | Intendencia y trenes de bagaje | Caravana de carretas de suministro con toneles y sacos atados |
| `tech.logistics_2` | Calzadas y postas militares | Calzada empedrada romana/medieval con hito miliario y jinete correo |
| `tech.logistics_3` | Campamentos fortificados | Foso, estacas afiladas *chevaux-de-frise* y tiendas ordenadas |
| `tech.logistics_4` | Estandartes, trompetas y banderas | Trompeta de guerra de latón junto a gran pendón desplegado al viento |
| `tech.logistics_5` | Marchas forzadas | Botas de campaña curtidas sobre mapa de ruta marcado bajo lluvia tenue |
| `tech.logistics_6` | Estado mayor logístico | Mesa de campaña con mapa hexagonal, compás de latón y sellos tácticos |
| `tech.tactics_inf_1` | Escuadras de lanceros y piqueros | Puntas de lanza inclinadas en muro cerrado de picas |
| `tech.tactics_arc_1` | Compañías de arqueros y ballesteros | Lluvia oblicua de flechas y virotes sobre formación cerrada |
| `tech.tactics_cav_1` | Monta y caballería pesada | Estribos de hierro, silla de guerra y lanza con pendón en ristre |
| `tech.tactics_inf_2` | Infantería de línea | Dos líneas compactas de hombres de armas con escudos y alabardas |
| `tech.tactics_arc_2` | Salvas y tiro en masa | Tres filas de arqueros disparando en arco simultáneo sobre cielo oscuro |
| `tech.tactics_cav_2` | Cargas de choque y maniobra | Cuña de caballería pesada rompiendo polvo bajo atardecer dorado |
| `tech.tactics_all` | Ejércitos de armas combinadas | Infantería, arqueros y caballería avanzando coordinados en emblema unificado |

#### E.5 — Rama Inteligencia y Exploración (8 tecnologías)

*Mismas especificaciones base que E.2 (`UniversityPanel.tsx`, 96×96 px, WebP, óleo nocturno de espionaje, prioridad Media/Baja).*

| Identificador técnico | Nombre visible | Prompt visual específico |
| :--- | :--- | :--- |
| `tech.espionage_1` | Red de confidentes I | Dos siluetas intercambiando carta sellada bajo arco oscuro de callejón |
| `tech.espionage_2` | Criptografía y agentes II | Disco cifrador de bronce medieval y pergamino con runas/números cifrados |
| `tech.espionage_3` | Informantes en la corte III | Copa dorada junto a nota doblada y llave maestra sobre terciopelo oscuro |
| `tech.espionage_4` | Maestros del espionaje IV | Daga estilizada y anillo de sello oscuro sobre mapa detallado de fortaleza |
| `tech.spy_1` | Ojos y oídos en el reino | Ojo vigilante tallado en bronce sobre reja entreabierta iluminada por vela |
| `tech.spy_2` | Exploradores y atalayas | Atalaya de madera en colina con catalejo de latón apuntando al horizonte |
| `tech.spy_3` | Guardia del silencio | Yelmo oscuro cubierto por capucha y emblema de llave sellada |
| `tech.spy_4` | Sombras del trono | Sombra alargada detrás de columna palaciega observando salón del consejo |

#### E.6 — Rama Civilización (48 tecnologías: 4 por cada una de las 12 civilizaciones)

*Mismas especificaciones base que E.2 (`UniversityPanel.tsx`, 96×96 px, WebP, rigor histórico cultural, prioridad Media/Baja).*

| Identificador técnico | Nombre visible | Civilización | Prompt visual específico |
| :--- | :--- | :--- | :--- |
| `tech.tech_civ_ingleses` | Arco largo inglés | Ingleses | Arco largo de tejo inglés de dos metros y flechas emplumadas |
| `tech.tech_civ_ingleses_a` | Arqueros de tiro largo | Ingleses | Batería de arqueros plantando estacas afiladas frente a la línea |
| `tech.tech_civ_ingleses_b` | Rotación de cultivos avanzada | Ingleses | Campiña inglesa parcelada con setos verdes y molino de agua |
| `tech.tech_civ_ingleses_c` | Dominio del Canal | Ingleses | Coca medieval inglesa de velas heráldicas surcando mar gris dorado |
| `tech.tech_civ_romanos` | Legión y testudo | Romanos | Escudos *scutum* rectangulares formando caparazón defensivo impermeable |
| `tech.tech_civ_romanos_a` | Formación de Testudo | Romanos | Muro cerrado de *gladius*, *pilum* y cascos gálicos imperiales |
| `tech.tech_civ_romanos_b` | Acueductos y calzadas | Romanos | Acueducto romano de doble arquería sobre calzada empedrada recta |
| `tech.tech_civ_romanos_c` | Legado de la Legión | Romanos | Estandarte con águila dorada y *vexillum* frente a legión formada |
| `tech.tech_civ_griegos` | Falange y dialéctica | Griegos | Escudos *hoplon* trabados bajo rollo de papiro filosófico |
| `tech.tech_civ_griegos_a` | Falange hoplita | Griegos | Bosque inclinado de picas *sarisa* sobre cascos de bronce |
| `tech.tech_civ_griegos_b` | Academias de filosofía | Griegos | Columnata de mármol con busto, esfera celeste y lámpara de aceite |
| `tech.tech_civ_griegos_c` | Arqueros cretenses | Griegos | Arco recurvo cretense y carcaj labrado de bronce y cuero |
| `tech.tech_civ_vikingos` | Drakkar y furia nórdica | Vikingos | Drakkar de velas cuadradas rayadas cortando fiordo oscuro (sin cuernos) |
| `tech.tech_civ_vikingos_a` | Navegación estelar | Vikingos | Piedra solar vikinga *sólarsteinn* y disco solar de madera sobre carta marina |
| `tech.tech_civ_vikingos_b` | Forja de acero nórdico | Vikingos | Espada Ulfberht de acero pautado brillante y hacha danesa recién forjada |
| `tech.tech_civ_vikingos_c` | Furia de los Berserkers | Vikingos | Piel de oso sobre hombro y escudo mordido en borde ante drakkar (sin cuernos) |
| `tech.tech_civ_bizantinos` | Fuego griego y baluartes | Bizantinos | Sifón de bronce bizantino proyectando fuego griego dorado sobre el mar |
| `tech.tech_civ_bizantinos_a` | Muros Teodosianos | Bizantinos | Triple línea escalonada de muralla bizantina de ladrillo y piedra |
| `tech.tech_civ_bizantinos_b` | Diplomacia imperial | Bizantinos | Bula áurea sellada con hilo de seda púrpura y pluma de oro |
| `tech.tech_civ_bizantinos_c` | Catafractos imperiales | Bizantinos | Lanza *kontos*, casco cónico y barda escamada de catafracto |
| `tech.tech_civ_arabes` | Medicina de Córdoba y riego | Árabes | Acequia con noria andalusí junto a tratado médico ilustrado árabe |
| `tech.tech_civ_arabes_a` | Sabiduría de la Casa | Árabes | Astrolabio planisférico de latón grabado y manuscrito geométrico |
| `tech.tech_civ_arabes_b` | Comercio de caravanas | Árabes | Caravana nocturna guiada por estrellas cruzando dunas doradas |
| `tech.tech_civ_arabes_c` | Tácticas de desierto | Árabes | Cimitarra ligera, escudo adarga y nube de polvo en flanqueo |
| `tech.tech_civ_mongoles` | Tácticas de la estepa | Mongoles | Dos jinetes mongoles rodeando en pinza por pradera infinita |
| `tech.tech_civ_mongoles_a` | Yasa y disciplina de la horda | Mongoles | Tableta de mando *Paiza* de bronce y plata con código grabado |
| `tech.tech_civ_mongoles_b` | Correo Yam | Mongoles | Jinete mensajero al galope cambiando de montura en posta de estepa |
| `tech.tech_civ_mongoles_c` | Arqueros a caballo de élite | Mongoles | Arco compuesto de cuerno y tendón con anillo de pulgar de jade |
| `tech.tech_civ_chinos` | Gran Muralla y pólvora | Chinos | Tramo almenado de muralla china en cresta montañosa y cohete de bambú temprano |
| `tech.tech_civ_chinos_a` | Exámenes imperiales | Chinos | Pincel caligráfico, barra de tinta y sello imperial de jade rojo |
| `tech.tech_civ_chinos_b` | Ballestas de repetición | Chinos | Ballesta china *chu-ko-nu* de cargador superior de madera pulida |
| `tech.tech_civ_chinos_c` | Mandato del Cielo | Chinos | Sello imperial dragón rodeado de nubes auspiciosas doradas |
| `tech.tech_civ_japoneses` | Acero Tamahagane y Bushido | Japoneses | Hoja de katana revelando línea de temple *hamon* frente a flor de cerezo |
| `tech.tech_civ_japoneses_a` | Código Bushido | Japoneses | Pergamino vertical con armadura *ō-yoroi* en soporte ritual |
| `tech.tech_civ_japoneses_b` | Maestros forjadores | Japoneses | Martillo japonés y masa de acero *tamahagane* brillante sobre yunque |
| `tech.tech_civ_japoneses_c` | Shogunato | Japoneses | Casco *kabuto* con cimera de media luna dorada y abanico de guerra |
| `tech.tech_civ_navajos` | Rastreadores del bosque | Navajos | Huellas discretas entre agujas de pino, arco de piñón y roca roja |
| `tech.tech_civ_navajos_a` | Sabiduría del coyote | Navajos | Silueta de coyote astuto al claro de luna sobre meseta del oeste |
| `tech.tech_civ_navajos_b` | Tejedores de sueños | Navajos | Telar vertical de madera con manta geométrica en lana teñida natural |
| `tech.tech_civ_navajos_c` | El Gran Camino del Bosque | Navajos | Sendero oculto serpenteando entre cañones y bosques de enebro |
| `tech.tech_civ_aztecas` | Chinampas y sacerdotes guerreros | Aztecas | Chinampas fértiles flotantes rodeadas de canales con maíz y calabaza |
| `tech.tech_civ_aztecas_a` | Sacrificios rituales | Aztecas | Brasero ceremonial de piedra tallada con humo de copal hacia cielo estrellado |
| `tech.tech_civ_aztecas_b` | Guerreros Jaguar y Águila | Aztecas | Yelmo de jaguar y yelmo de águila afrontados con escudo *chimalli* |
| `tech.tech_civ_aztecas_c` | Imperio de la Triple Alianza | Aztecas | Tres glifos de piedra labrada unidos sobre estandarte de plumas de quetzal |
| `tech.tech_civ_masais` | Resistencia masái y sabana | Masáis | Horizonte infinito de sabana dorada con silueta de lanzas y acacias |
| `tech.tech_civ_masais_a` | Guerreros Morani | Masáis | Dos escudos ovalados masáis decorados y lanzas *ol-alem* cruzadas |
| `tech.tech_civ_masais_b` | Ganadería trashumante | Masáis | Rebaño de cebúes guiado por pastor con *shúkà* roja bajo luz dorada |
| `tech.tech_civ_masais_c` | El Gran Salto | Masáis | Guerreros en danza ceremonial vertical *adumu* al atardecer dorado |

**Subtotal Categoría E:** **140 activos** (5 emblemas de rama + 135 tecnologías: 26 económicas + 21 civiles + 32 militares + 8 inteligencia + 48 de civilización).

---

### Categoría F — Interfaz, Navegación, Recursos y HUD (22 activos)

Incluye pantallas de entrada (`HomeScreen.tsx`), recursos (`App.tsx`, `MarketPanel.tsx`), pestañas (`TabNavigation.tsx`), recompensas especiales y estados climáticos/políticos.

| Identificador técnico | Nombre visible en el juego | Dónde aparece en UI | Tamaño / relación | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `ui.home_hero_desktop` | Portada oficial La Conquista | `HomeScreen.tsx` | 1536×1024 px (3:2) | JPG / WebP | Óleo cinematográfico medieval | Alta | *(Ya activo)* Rey coronado ante castillo y río al atardecer con espacio oscuro derecho para panel de acceso. | **Implementado** (`/assets/aistudio/1793086836321_852e3733.jpg`) |
| `ui.home_hero_mobile` | Cabecera móvil La Conquista | `HomeScreen.tsx` | 800×450 px (16:9) | WebP | Óleo cinematográfico medieval | Media | Recorte horizontal enfocado en la silueta del monarca y fortaleza dejando margen inferior fundido a `#070b12`. | Reutiliza imagen desktop con `object-left` |
| `resource.gold` | Oro | `App.tsx`, `MarketPanel.tsx`, `BuildingsAndQueue.tsx` | 64×64 px | PNG / SVG | Icono ilustrado en relieve metálico | Alta | Pila pequeña de monedas antiguas de oro acuñadas con brillo cálido sobre fondo transparente. | Usa Lucide `Coins` / emoji `🪙` |
| `resource.wood` | Madera | Mismos que arriba | 64×64 px | PNG / SVG | Icono ilustrado en relieve natural | Alta | Tres troncos de roble atados con corteza oscura y corte dorado al centro sobre fondo transparente. | Usa Lucide `TreePine` / emoji `🪵` |
| `resource.stone` | Piedra | Mismos que arriba | 64×64 px | PNG / SVG | Icono ilustrado en relieve pétreo | Alta | Sillares de piedra caliza tallada apilados con sombreado cincelado sobre fondo transparente. | Usa Lucide `Pickaxe` / emoji `🪨` |
| `resource.iron` | Hierro | Mismos que arriba | 64×64 px | PNG / SVG | Icono ilustrado en relieve metálico | Alta | Lingote de hierro forjado gris acero junto a mena mineral oscura sobre fondo transparente. | Usa Lucide `Anvil` / emoji `⚒️` |
| `resource.food` | Alimentos | Mismos que arriba | 64×64 px | PNG / SVG | Icono ilustrado natural | Alta | Gavilla dorada de trigo atada junto a hogaza de pan rústico sobre fondo transparente. | Usa Lucide `Wheat` / emoji `🍞` |
| `resource.population` | Población civil / censo | `App.tsx` | 64×64 px | PNG / SVG | Icono heráldico sobrio | Media | Tres siluetas medievales estilizadas en bronce cálido dentro de marco circular sutil. | Usa Lucide `Users` |
| `tab.aldea` | Pestaña Aldea | `TabNavigation.tsx` | 48×48 px | PNG / SVG | Icono metálico oro envejecido | Media | Torreón señorial estilizado en oro bruñido con borde limpio para barra superior y móvil. | Usa Lucide `Castle` |
| `tab.ejercito` | Pestaña Ejército | `TabNavigation.tsx` | 48×48 px | PNG / SVG | Icono metálico oro envejecido | Media | Dos espadas cruzadas sobre escudo apuntado en bronce dorado pulido. | Usa Lucide `Swords` |
| `tab.universidad` | Pestaña Universidad | `TabNavigation.tsx` | 48×48 px | PNG / SVG | Icono metálico oro envejecido | Media | Astrolabio y pluma sobre códice abierto en relieve dorado. | Usa Lucide `GraduationCap` |
| `tab.parlamento` | Pestaña Parlamento | `TabNavigation.tsx` | 48×48 px | PNG / SVG | Icono metálico oro envejecido | Media | Pórtico clásico de tres columnas con balanza real encima en oro viejo. | Usa Lucide `Landmark` |
| `tab.mapa` | Pestaña Mapa | `TabNavigation.tsx` | 48×48 px | PNG / SVG | Icono metálico oro envejecido | Media | Pergamino cartográfico enrollado con rosa de los vientos en oro. | Usa Lucide `Map` |
| `ui.founding_crest` | Escudo de Creación del Reino | `FoundingWizard.tsx`, `KingdomCreationWizard.tsx` | 192×192 px | WebP / PNG | Sello real dorado | Media | Gran escudo real vacío coronado de laureles de oro con corona flotante y pergamino base. | Usa Lucide `Castle` |
| `ui.compensation_chest` | Compensación de la Corona | `App.tsx` (`OutageCompensationCard`) | 160×160 px | WebP / PNG | Óleo cálido dorado | Media | Cofre de roble reforzado con herrajes dorados entreabierto mostrando monedas, espigas y lingotes bajo luz real. | Usa Lucide `Gift` |
| `season.primavera` | Primavera | HUD superior `App.tsx` | 48×48 px | PNG / SVG | Medallón estacional | Baja | Rama florida de almendro en tono dorado pálido sobre esmalte verde oscuro. | Texto/Lucide |
| `season.verano` | Verano | HUD superior `App.tsx` | 48×48 px | PNG / SVG | Medallón estacional | Baja | Sol heráldico radiante en oro brillante sobre esmalte ámbar oscuro. | Texto/Lucide |
| `season.otono` | Otoño | HUD superior `App.tsx` | 48×48 px | PNG / SVG | Medallón estacional | Baja | Hoja de roble cobriza y espiga madura sobre esmalte terracota oscuro. | Texto/Lucide |
| `season.invierno` | Invierno | HUD superior `App.tsx` | 48×48 px | PNG / SVG | Medallón estacional | Baja | Estrella geométrica de escarcha plateada sobre esmalte azul noche. | Texto/Lucide |
| `policy.rest_normal` | Descanso normal | `App.tsx` (Política del Castillo) | 64×64 px | PNG / SVG | Sello sobrio | Baja | Reloj de arena equilibrado en latón y madera noble. | Texto plano |
| `policy.rest_intensiva` | Jornada intensiva («A tope») | `App.tsx` | 64×64 px | PNG / SVG | Sello dinámico cálido | Baja | Martillo golpeando yunque con estela de chispas doradas y reloj inclinado. | Texto plano |
| `policy.rest_relajada` | Jornada relajada | `App.tsx` | 64×64 px | PNG / SVG | Sello apacible | Baja | Cáliz de madera, rama de olivo y luna creciente suave en oro mate. | Texto plano |

**Subtotal Categoría F:** **22 activos** (2 portadas + 6 iconos de recurso/censo + 5 pestañas + 2 sellos especiales + 4 estaciones + 3 políticas).

---

### Categoría G — Misiones, Hitos y Eventos (49 activos)

Incluye **4 sellos de etapa**, **22 misiones de etapa**, **6 misiones diarias**, **4 misiones secretas generales**, **12 misiones secretas por civilización** (`MISSIONS` en `balanceConfig.ts`) y **1 insignia de celebración/trofeo** (`MissionsPanel.tsx`).

| Identificador técnico | Nombre visible en el juego | Dónde aparece | Tamaño | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `mission_ui.celebration_trophy` | Trofeo de Misión / Hito | `MissionsPanel.tsx` (`MissionCelebrations`) | 96×96 px | PNG / WebP | Medallón heráldico brillante | Media | Copa real de oro cincelado rodeada de hojas de laurel con halo cálido suave sobre fondo oscuro. | Usa Lucide `Trophy` |
| `mission_stage.1` | Etapa 1: Los primeros pasos | `MissionsPanel.tsx` | 96×96 px | WebP | Sello lacrado bronce | Baja | Sello de cera bronce con torre naciente e iniciales romanas `I` estilizadas. | Usa Lucide `Award` |
| `mission_stage.2` | Etapa 2: Un reino en marcha | `MissionsPanel.tsx` | 96×96 px | WebP | Sello lacrado plata | Baja | Sello de cera plateada con pergamino y estandarte real. | Usa Lucide `Award` |
| `mission_stage.3` | Etapa 3: La corona se afirma | `MissionsPanel.tsx` | 96×96 px | WebP | Sello lacrado oro | Baja | Sello dorado con corona y dos espadas cruzadas en relieve. | Usa Lucide `Award` |
| `mission_stage.4` | Etapa 4: Señor de la guerra | `MissionsPanel.tsx` | 96×96 px | WebP | Sello lacrado rubí y oro | Baja | Medallón imperial de oro con yelmo coronado, escudo y laurel dorado. | Usa Lucide `Award` |
| `mission.s1_castillo2` | Torres más altas | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Torre almenada elevándose bajo andamios de madera y luna dorada. | Usa `Circle` / `CheckCircle2` |
| `mission.s1_cuartel` | Llamada a las armas | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Lanza vertical apoyada en escudo con cuerno de llamada de bronce. | Usa `Circle` |
| `mission.s1_taberna` | Posada del reino | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Jarra de peltre rebosante frente a farol colgante de posada. | Usa `Circle` |
| `mission.s1_tropas` | Primera leva | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Casco de infantería y espada envainada sobre tablón de recluta. | Usa `Circle` |
| `mission.s1_universidad` | Casa del saber | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Vela encendida iluminando libro antiguo abierto y tintero. | Usa `Circle` |
| `mission.s2_castillo3` | Sede del poder | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Doble torreón real iluminado con estandartes dorados al viento. | Usa `Circle` |
| `mission.s2_investigacion` | Primer descubrimiento | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Astrolabio de latón y pergamino recién desenrollado. | Usa `Circle` |
| `mission.s2_poblacion` | Ciudad creciente | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Techos medievales apiñados con chimeneas humeantes al alba. | Usa `Circle` |
| `mission.s2_ejercito` | Guarnición | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Hileras de lanzas y escudos guardando puerta amurallada. | Usa `Circle` |
| `mission.s2_parlamento` | Voz entre reinos | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Pergamino real con gran sello de lacre colgante sobre mesa de consejo. | Usa `Circle` |
| `mission.s3_castillo4` | Alcázar | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Ciudadela imponente de muros altos en escarpe rocoso. | Usa `Circle` |
| `mission.s3_murallas` | Piedra sobre piedra | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Muro grueso coronado de almenas con rastrillo de hierro alzado. | Usa `Circle` |
| `mission.s3_desafio` | Guante arrojado | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Guantelete de acero caído sobre piedra gris frente a sello lacrado. | Usa `Circle` |
| `mission.s3_batalla` | Bautismo de fuego | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Espada y escudo marcados por batalla frente a estandarte entre humo. | Usa `Circle` |
| `mission.s3_victoria` | Primera victoria | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Corona de laurel dorado rodeando hoja de espada vertical limpia. | Usa `Circle` |
| `mission.s3_tecnologias` | Tres saberes | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Tres tomos eruditos iluminados en dorado sobre atril de roble. | Usa `Circle` |
| `mission.s4_castillo6` | Ciudadela | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Gran alcázar palatino con múltiples torres, foso y puente Real. | Usa `Circle` |
| `mission.s4_ejercito` | Hueste real | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Formación cerrada de picas, escudos y caballería bajo pendón real. | Usa `Circle` |
| `mission.s4_victorias` | Cinco laureles | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Medallón de cinco hojas de oro en arco triunfal medieval. | Usa `Circle` |
| `mission.s4_aplastante` | Sin cuartel | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Lanza rota enemiga junto a gran hacha o espada victoriosa iluminada. | Usa `Circle` |
| `mission.s4_territorio` | Nuevas tierras | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Banderín real clavado en colina virgen al amanecer sobre horizonte extenso. | Usa `Circle` |
| `mission.s4_hospital` | Cuidar a los nuestros | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Botiquín medieval, cáliz de hierbas y cruz hospitalaria sobria. | Usa `Circle` |
| `mission.d_obra` | Manos a la obra (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Martillo de obra y paleta de albañil sobre ladrillo recién puesto. | Usa `Circle` |
| `mission.d_tropas` | Instrucción diaria (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Diana de paja con flecha clavada al centro y espada de madera. | Usa `Circle` |
| `mission.d_investigar` | Hora de estudio (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Reloj de arena dorado junto a pergamino abierto y lupa de cristal. | Usa `Circle` |
| `mission.d_bonus` | Tributo diario (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Pequeño cofre tributario abierto con monedas doradas y sello real. | Usa `Circle` |
| `mission.d_explorar` | Ojos en el horizonte (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Brújula de mano abierta orientada hacia cordillera brumosa. | Usa `Circle` |
| `mission.d_batalla` | Al campo de batalla (Diaria) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Miniatura de sello medieval | Baja | Cuerno de guerra, escudo y lanza dispuestos bajo cielo rojo de alba. | Usa `Circle` |
| `mission.x_felicidad` | Reino feliz (Secreta) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Sello secreto dorado/azul | Baja | Villa iluminada con guirnaldas festivas y faroles cálidos nocturnos. | Usa sello oculto |
| `mission.x_tesoro` | Arcas rebosantes (Secreta) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Sello secreto dorado | Baja | Bóveda abierta con arcas repletas de monedas de oro relucientes. | Usa sello oculto |
| `mission.x_honor` | Nombre respetado (Secreta) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Sello secreto dorado | Baja | Anillo sigilar real en oro sellando pergamino diplomático en relieve. | Usa sello oculto |
| `mission.x_exploradores` | Cartógrafos (Secreta) | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Sello secreto sepia | Baja | Mapa antiguo extendido con compás, pluma de tinta y rosa de los vientos. | Usa sello oculto |
| `mission.x_civ_ingleses` | Herederos de Agincourt | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Emblema de arcos largos cruzados sobre blasón inglés victorioso. | Usa sello oculto |
| `mission.x_civ_romanos` | Senatus Populusque | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Águila imperial dorada rodeada de guirnalda senatorial de laurel. | Usa sello oculto |
| `mission.x_civ_griegos` | Luz de la Academia | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Lámpara ateniense de aceite iluminando columnata y mochuelo sabio. | Usa sello oculto |
| `mission.x_civ_vikingos` | Saga de los mares | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Piedra rúnica tallada con drakkar surcando olas nórdicas. | Usa sello oculto |
| `mission.x_civ_bizantinos` | Púrpura imperial | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Manto púrpura y corona imperial bizantina sobre fondo teselado en oro. | Usa sello oculto |
| `mission.x_civ_arabes` | Sabios del califato | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Astrolabio dorado y tratados árabes iluminados bajo arco geométrico. | Usa sello oculto |
| `mission.x_civ_mongoles` | Jinetes de la estepa | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Estandarte de nueve colas blancas sobre horizonte abierto de estepa. | Usa sello oculto |
| `mission.x_civ_chinos` | Mandato del Cielo | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Sello imperial de jade verde y oro en estuche de laca roja. | Usa sello oculto |
| `mission.x_civ_japoneses` | Camino del guerrero | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Katana apoyada en soporte ceremonial frente a pétalos y sol dorado. | Usa sello oculto |
| `mission.x_civ_navajos` | Senderos sagrados | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Pluma ceremonial y mapa arenoso de cuatro direcciones bajo cielo estrellado. | Usa sello oculto |
| `mission.x_civ_aztecas` | Sol de Tenochtitlan | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Piedra solar dorada emergiendo sobre ciudad lacustre de canales. | Usa sello oculto |
| `mission.x_civ_masais` | Guardianes de la sabana | `MissionsPanel.tsx` | 64×64 px | WebP / PNG | Medallón secreto civilización | Baja | Escudo *el-longo* y lanzas cruzadas ante acacia solitaria al alba. | Usa sello oculto |

**Subtotal Categoría G:** **49 activos** (1 trofeo celebración + 4 sellos de etapa + 22 misiones de etapa + 6 misiones diarias + 4 secretas generales + 12 secretas de civilización).

---

### Categoría H — Comercio, Parlamento y Diplomacia (8 activos)

| Identificador técnico | Nombre visible en el juego | Dónde aparece en UI | Tamaño / relación | Formato | Estilo visual | Prioridad | Descripción visual detallada (prompt) | Estado actual |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `trade.market_banner` | Mercado del Reino | `MarketPanel.tsx` | 800×200 px (4:1) / 16:9 | WebP | Óleo panorámico medieval cálido | Media | Gran plaza mercantil medieval con puestos de tela ocre, básculas de latón, sacos de especias y carromatos cargados de hierro y madera. | Usa Lucide `Scale` |
| `trade.locked_gate` | Intercambio Comercial Bloqueado | `MarketPanel.tsx` (Mercado < Nv. 4) | 256×192 px (4:3) | WebP | Óleo sobrio en penumbra | Baja | Portón de lonja cerrado con pesado candado de hierro forjado y sello real en espera de apertura. | Usa Lucide `Lock` |
| `diplomacy.parliament_chamber` | Cámara del Parlamento | `ParliamentPanel.tsx` | 800×200 px (4:1) | WebP | Óleo solemne arquitectónico | Media | Hemiciclo medieval de piedra iluminado por ventanales altos con escaños de roble tallado, mapas y candelabros dorados. | Usa Lucide `Landmark` |
| `diplomacy.challenge_seal` | Desafío / Reto Formal | `ParliamentPanel.tsx` (Desafíos) | 96×96 px | PNG / WebP | Sello lacrado carmesí | Media | Pergamino enrollado atado con cinta roja y gran sello de lacre roto por punta de daga ceremonial. | Usa Lucide `Scroll` |
| `diplomacy.espionage_dossier` | Informe de Espionaje | `ParliamentPanel.tsx` | 96×96 px | PNG / WebP | Óleo oscuro de gabinete | Media | Sobre cifrado entreabierto revelando cifras manuscritas y catalejo pequeño sobre mesa de nogal oscuro. | Usa Lucide `Eye` |
| `diplomacy.battle_chronicle` | Historial de Batallas | `ParliamentPanel.tsx` | 96×96 px | PNG / WebP | Grabado/óleo bélico | Media | Libro abierto de crónicas con espada apoyada y escudo abollado bajo luz cálida lateral. | Usa Lucide `Swords` |
| `diplomacy.leaderboard_crown` | Clasificación Global de Reinos | `ParliamentPanel.tsx` | 96×96 px | PNG / WebP | Trofeo heráldico áureo | Media | Copa alta de oro y corona imperial sobre columna de mármol oscuro rodeada de laureles. | Usa Lucide `Trophy` |
| `diplomacy.daily_tribute` | Tributo / Bonus Diario | `ParliamentPanel.tsx`, `App.tsx` | 96×96 px | PNG / WebP | Ilustración de sello dorado | Baja | Bando real con medalla de honor de oro bruñido y cinta azul real. | Usa Lucide `Award` |

**Subtotal Categoría H:** **8 activos**.

---

## 3. Resumen cuantitativo por categoría y total general

| Categoría | Descripción | Cantidad de activos | Con asset real montado | Huérfanos sin montar | Pendientes de diseño/generación |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **A** | Edificios y arquitectura (`BUILDINGS` + singulares + cuadrilla) | **31** | 0 | 0 | 31 |
| **B** | Tropas, asedio, mercenarios, espía y tropas singulares | **33** | 0 | 2 | 31 |
| **C** | Civilizaciones (12 emblemas) + Bots Parlamento (5 perm. + 42 rot.) | **59** | 0 | 0 | 59 |
| **D** | Mapa, terrenos, niebla de guerra y marcadores canvas | **14** | 0 | 0 | 14 |
| **E** | Tecnologías (5 emblemas de rama + 135 tecnologías) | **140** | 0 | 0 | 140 |
| **F** | Interfaz, portada, recursos, pestañas, estaciones y políticas | **22** | 1 | 0 | 21 |
| **G** | Misiones (trofeo, 4 etapas, 22 etapa, 6 diarias, 4+12 secretas) | **49** | 0 | 0 | 49 |
| **H** | Comercio, Parlamento y Diplomacia | **8** | 0 | 0 | 8 |
| **TOTAL** | **Total general auditado en el proyecto** | **356** | **1** | **2** | **353** |

---

## 4. Agrupación por viabilidad técnica de integración

### Grupo A — Listo en UI / solo sustitución directa (**16 activos**)
Elementos donde ya existe `<img ...>` o un renderizador gráfico directo donde basta sustituir la ruta de imagen o dibujar el `HTMLImageElement` precargado sin refactorizar la estructura:
- `ui.home_hero_desktop` y `ui.home_hero_mobile` en `src/components/HomeScreen.tsx` (ya usan `<img>` hacia `/assets/aistudio/1793086836321_852e3733.jpg`).
- Los **6 terrenos** (`terrain.llanura`, `bosque`, `colina`, `montana`, `rio`, `costa`), `terrain.desconocido` y los **7 marcadores tácticos** (`map_marker.*`) en `src/components/MapPanel.tsx`: el lienzo `<canvas>` ya dispone de coordenadas axiales, frustum culling y pasada 2 de iconos; solo requiere un pequeño mapa de `ImageBitmap` precargados y `ctx.drawImage(...)` con fallback al color/glyph actual.

### Grupo B — Falta añadir soporte / huecos visuales en componentes (**324 activos**)
Componentes actualmente basados en emojis Unicode, iconos genéricos de `lucide-react` o tarjetas solo de texto que necesitan incorporar un componente reutilizable de miniatura/retrato con `loading="lazy"` y fallback a emoji/Lucide:
- **Categoría A (31):** `BuildingsAndQueue.tsx` y `App.tsx` (sustituir `b.emoji` / icono `Castle` por `<BuildingArtwork id={b.type} civ={kingdom.civilization} />`).
- **Categoría B (31 de 33):** `ArmyPanel.tsx`, `TroopSelector.tsx` y `App.tsx` (añadir miniatura 48×48 / 64×64 en catálogo de reclutamiento, asedio nominal, espías y tarjetas de mercenarios en Taberna).
- **Categoría C (59):** `FoundingWizard.tsx` y `ParliamentPanel.tsx` (emblemas de las 12 civilizaciones sustituyendo `🏹`, `🏛️`, etc.; retratos circulares 48×48 para los 47 monarcas bot).
- **Categoría E (140):** `UniversityPanel.tsx` (sustituir `BookOpen` repetido por `<TechBadge id={technology.id} branch={technology.branch} />`).
- **Categoría F (20 de 22):** `TabNavigation.tsx` (5 pestañas), `App.tsx` (5 recursos + censo + compensación + estaciones + políticas de descanso).
- **Categoría G (49):** `MissionsPanel.tsx` (sellos de etapa, miniaturas de misión y trofeo de celebración).
- **Categoría H (8):** `MarketPanel.tsx` y `ParliamentPanel.tsx` (cabeceras de Mercado/Parlamento y sellos de desafíos/espionaje/batallas).

### Grupo C — Requiere mapeo previo o normalización de identificadores (**16 activos / reglas de cruce**)
Antes de inyectar gráficos en estos puntos es imprescindible normalizar los diccionarios de frontend/backend para evitar imágenes rotas:
1. **Imágenes huérfanas sin diccionario en `/public/assets/images/units/` (`2` archivos):** `unidad_ingles_arquero_arco_largo.jpg` y `unidad_romana_legionario.png` no están indexados por ningún registro (`Record<string, string>`) ni responden a `civilization + unitType`. Requieren un resolver canónico `getUnitPortraitPath(unitType, civilization)` con fallback a unidad genérica.
2. **Normalización de `UNIT_LABELS` en `src/components/shared.tsx` (`11` claves faltantes):** `shared.tsx` solo define `infanteria`, `arqueria`, `caballeria`, `asedio`, omitiendo las **10 máquinas de asedio nominales** (`onagro_campana`, `carrobalista`, etc.) y `espia`. Debe unificarse con `UNITS` de `convex/balanceConfig.ts`.
3. **Alias heredados de civilización y tecnología (`LEGACY_CIVILIZATION_IDS`, `LEGACY_TECHNOLOGY_IDS`):** cuentas antiguas pueden almacenar `indiosAmericanos` (`navajos`), `keniatas` (`masais`), `vikingo` (`vikingos`) o `tech_civ_indiosAmericanos` / `tech_civ_keniatas`. El resolver visual debe aplicar normalización de ID antes de buscar rutas de emblema, edificio singular, tropa característica o tecnología.
4. **Identidades singulares por civilización (`CIVILIZATION_IDENTITIES`):** la vista debe decidir de forma determinista cuándo mostrar el arte genérico (`building.cuartel`) o la variante cultural (`building_unique.ingleses.cuartel`, `sig_unit.romanos`) usando un único mapa centralizado sin duplicar strings en múltiples componentes.

---

## 5. Orden recomendado de producción (si se aprobara en una fase futura)

1. **Oleada 1 (Impacto visual inmediato, 29 activos):** 5 iconos de recursos + 12 emblemas de civilización + 4 tropas principales + 1 espía + 6 terrenos de mapa + 1 cofre de compensación.
2. **Oleada 2 (Identidad del reino, 24 activos):** 18 edificios base + 6 mercenarios de Taberna.
3. **Oleada 3 (Profundidad cultural y táctica, 35 activos):** 12 tropas singulares (aprovechando las 2 ya existentes) + 10 máquinas de asedio + 5 emblemas de rama tecnológica + 8 elementos de Parlamento/Mercado.
4. **Oleada 4 (Catálogo completo de colección, 268 activos):** 12 edificios singulares + 47 retratos de bots + 135 iconos de tecnologías + 49 sellos de misiones + 7 marcadores canvas y detalles menores de HUD.
