# LA CONQUISTA — Información pendiente para completar los bloques

**Fecha:** 2026-10-17
**Rama:** `ccr-5630b85b-8bybdp`
**Objeto:** inventario de todos los datos que faltan para poder ejecutar las tareas pendientes sin inventar mecánicas, fórmulas, costes, tiempos, requisitos ni bonificaciones (principio 1 del documento *Indicaciones del Juego*).

---

## 1. Qué se ha revisado y qué se ha encontrado

| Fuente revisada | Resultado |
|---|---|
| Historial completo de Git (10 commits, ramas `main` y `ccr-5630b85b-8bybdp`, todos los archivos que han existido alguna vez) | No existe ningún documento de especificación. El único `README.md` que hubo era la plantilla de AI Studio y fue borrado en el segundo commit. |
| `docs/BLOQUE_9.txt` | Cierra el Bloque 9 a nivel de flujos; lista sus propios pendientes numéricos (ver §4.F). |
| `docs/La_Conquista_Indicaciones_del_Juego.pdf` (aportado el 2026-10-17) | Reconstrucción parcial de la memoria del proyecto. Su propia sección 9 declara que **no** contiene costes, salarios, capacidad de entrenamiento, penalizaciones, duraciones ni requisitos por unidad. No menciona parámetros de edificios, tecnologías, territorios ni batallas. |
| Issues y pull requests de GitHub | Ninguno abierto ni cerrado. |
| Búsqueda de valores en todos los blobs del historial (`coste`, `Especificación Maestra`, `P37`, `P29`, `salario`, `unitCost`, `techType`, etc.) | Solo aparecen en comentarios de código, en el PDF y en el catálogo `convex/buildingsCatalog.ts` descrito en §3. |

**Conclusión:** salvo las constantes de §2, la información necesaria no está en el repositorio ni en el PDF. Este documento enumera, bloque por bloque, qué hace falta y en qué formato entregarlo.

---

## 2. Lo que SÍ está confirmado (no hace falta volver a definirlo)

| Regla | Valor | Dónde vive |
|---|---|---|
| Escala temporal (P2) | 1 día real = 1 año de juego = 86.400 s | `convex/economyCalculations.ts` |
| Recursos (P3) | oro, madera, piedra, hierro, alimentos | `convex/economyCalculations.ts` |
| Población inicial (P10) | 2.000 habitantes | `convex/economyCalculations.ts` |
| Raciones (P17) | mínima 0,75 · normal 1,00 · abundante 1,10 · excelente 1,20 | `convex/economyCalculations.ts` |
| Consumo militar (P18) | factor 1,05 para tropas regulares | `convex/economyCalculations.ts` |
| Consumo civil base | 1 ración por habitante y día real | `convex/economyCalculations.ts` (marcado "aprobado") |
| Producción agrícola | 2 alimentos por agricultor y día real | `convex/economyCalculations.ts` (marcado "aprobado") |
| Nivel máximo de edificios | 100 | `convex/buildingRules.ts` |
| Ranuras de construcción simultáneas | 2 | `convex/buildingRules.ts` |
| Duración por nivel | base × (1 + 0,01 × (nivel − 1)) | `convex/buildingRules.ts` |
| Reclutamiento | solo de población civil libre, sin retirar trabajadores productivos (decisión posterior, prevalece) | PDF §3 y §4 |
| Tipos de unidad existentes | infanteria, caballeria, arqueria, asedio | `convex/kingdoms.ts` |
| Autoridad del servidor (P66, P67) | toda regla se valida en Convex | todo `convex/` |

Valores marcados en el código como **provisionales** (funcionan, pero no están aprobados): régimen alimentario inicial "normal", reparto inicial de trabajadores (1.100 / 250 / 250 / 100 / 50) y reserva civil 250, soldados iniciales 0, recursos iniciales (500 / 1.000 / 800 / 250 / 2.500).

---

## 3. Conflicto detectado: dos catálogos de edificios

| Archivo | Contenido | ¿Lo usa el backend? |
|---|---|---|
| `convex/buildingRules.ts` (commit 4b99840, 16-oct) | 11 edificios con costes, duración, capacidades y requisitos **a `null`** | **Sí.** Lo importan `convex/buildings.ts`, `convex/kingdoms.ts`, `convex/economyAdapter.ts` y `src/App.tsx`. Con `null`, la construcción queda bloqueada. |
| `convex/buildingsCatalog.ts` + `convex/buildingsCalculations.ts` (commit 9c8cd9b, 17-oct) | 12 edificios (añade `herreria`) con costes, duraciones, capacidades y prerrequisitos **numéricos**, cabecera "OFICIAL", coste escalado +15 % por nivel, reembolso 50 % al cancelar | **No.** Ningún módulo del backend ni de la interfaz los importa. |

Los números de `buildingsCatalog.ts` no aparecen en el PDF ni en ningún otro documento del repositorio, y sus comentarios ("cubre los 1.100 iniciales", "satisface censo inicial de 2000") sugieren que fueron derivados para encajar con la configuración de prueba, no copiados de la Especificación Maestra. **No se han aplicado.**

> **Decisión necesaria (D-01):** ¿Los valores de `buildingsCatalog.ts` son oficiales y deben cargarse en `buildingRules.ts`, o hay que descartarlos y rellenar la tabla de §4.A con los valores de la Especificación Maestra?

---

## 4. Faltantes por bloque

Cada apartado indica qué falta, qué ocurre mientras falte y qué formato de respuesta permite cargarlo directamente en el código.

### 4.A Edificios y construcción

**Qué ocurre mientras falte:** `startConstruction` rechaza cualquier obra con "pendientes de especificación oficial"; la interfaz muestra capacidad de población y producción por edificio como "Pendiente".

**Tabla a rellenar** (un valor por celda; si un edificio no tiene capacidad, escribir 0):

| Edificio | Oro | Madera | Piedra | Hierro | Alimentos | Duración base nivel 1 (s) | Capacidad residencial por nivel | Capacidad de trabajadores por nivel | Oficio que habilita | Requisitos (edificio ≥ nivel) |
|---|---|---|---|---|---|---|---|---|---|---|
| castillo | | | | | | | | | — | |
| viviendas | | | | | | | | — | — | |
| granja | | | | | | | — | | agricultura | |
| aserradero | | | | | | | — | | madera | |
| cantera | | | | | | | — | | piedra | |
| minaHierro | | | | | | | — | | hierro | |
| cuartel | | | | | | | — | | — | |
| herreria (¿existe en el catálogo oficial?) | | | | | | | — | | — | |
| universidad | | | | | | | — | — | — | |
| murallas | | | | | | | — | — | — | |
| mercado | | | | | | | — | — | — | |
| parlamento | | | | | | | — | — | — | |

**Reglas adicionales por confirmar:**

- D-02 ¿El coste escala con el nivel? Si sí, fórmula (en `buildingsCatalog.ts` aparece +15 % por nivel, sin fuente).
- D-03 ¿La capacidad por nivel es lineal (capacidad × nivel) o tiene otra curva?
- D-04 Porcentaje de reembolso al cancelar una obra (en `buildingsCatalog.ts` aparece 50 %, sin fuente; `buildingRules.ts` calcula reembolso proporcional al tiempo restante). ¿Cuál es la regla?
- D-05 ¿Ningún edificio puede superar el nivel del Castillo? (aparece en la cabecera de `buildingsCatalog.ts` como regla de la Especificación Maestra; confirmar).
- D-06 Lista de prerrequisitos citados en esa cabecera, confirmar o corregir: Cuartel ← Castillo 1; Mina de hierro ← Cantera 1; Herrería ← Cuartel 1 + Mina 1; Universidad ← Castillo 2; Parlamento ← Castillo 2.
- D-07 ¿Qué produce el oro? Hay trabajadores `gold` (50 iniciales) pero ningún edificio ni tasa de producción de oro.

### 4.B Ejército y entrenamiento

**Qué existe:** tablas `armyUnits` y `trainingQueue` en el esquema (sin desplegar), lectura `kingdoms:getArmyUnits`, validador de tipos y cantidades. **No existe ninguna mutación de entrenamiento**, ni catálogo de unidades, ni completado automático.

**Tabla a rellenar:**

| Unidad | Oro | Madera | Piedra | Hierro | Alimentos | Duración de entrenamiento por unidad o por lote (s) | Población civil libre consumida por unidad | Salario (recurso y periodicidad) | Requisitos (edificio ≥ nivel) |
|---|---|---|---|---|---|---|---|---|---|
| infanteria | | | | | | | | | |
| caballeria | | | | | | | | | |
| arqueria | | | | | | | | | |
| asedio | | | | | | | | | |

**Decisiones por confirmar:**

- D-08 Duración de entrenamiento: el PDF cita "una semana de juego (≈ 28 min reales)" como documentación anterior, no confirmada. ¿Es la regla vigente y aplica a todos los tipos?
- D-09 ¿Cuántos lotes de entrenamiento simultáneos admite un reino? ¿Depende del nivel del Cuartel?
- D-10 Política de cancelación de entrenamiento: ¿devolución de recursos (porcentaje) y de población?
- D-11 Fuente de verdad del ejército: `armyUnits` (tabla relacional) o `regularSoldiers` (campo heredado en `kingdoms`). Hoy la economía lee el campo heredado y la interfaz lee la tabla; hay riesgo de contar dos veces.
- D-12 ¿Las máquinas de asedio consumen alimentos con el factor 1,05? Hoy existe un interruptor en la interfaz porque P18 no lo especifica.
- D-13 Calidad militar P29 (niveles 1–5, multiplicadores 100 / 115 / 135 / 160 / 190 %): ¿vigente? ¿Se implementa?
- D-14 Requisitos P30–P31 (Entrenado: Castillo 2 + Barracones 2; Veterano: Castillo 4 + Barracones 3 + Universidad 2; Profesional: Castillo 6 + Barracones 4 + Universidad 3; Élite: Castillo 8 + Barracones 5 + Universidad 4 + Herrería 5): ¿vigentes? "Barracones" ¿equivale a `cuartel`?
- D-15 Tabla antigua `Armyunits` (con mayúscula) frente a `armyUnits`: el código consulta ambas. ¿Se puede retirar la antigua?

### 4.C Tecnologías e investigación

**Qué existe:** nada en el backend. La interfaz reserva el campo `technologies` y las interfaces provisionales citan `technologies:getTechnologies` y `technologies:researchTechnology` observadas en un despliegue anterior.

**Falta todo:**

- D-16 Lista de tecnologías (identificador, nombre, descripción).
- D-17 Coste y duración de investigación de cada una; si tienen niveles, la curva.
- D-18 Efecto de cada tecnología (qué modifica y en cuánto).
- D-19 Requisitos previos (otras tecnologías, nivel de Universidad).
- D-20 ¿Se investiga una a la vez o varias en paralelo?
- D-21 Modelo de datos: un documento por tecnología adquirida, o un documento por reino.

### 4.D Territorios y mapa

**Qué existe:** nada. Solo la consulta `territories:getTerritories` observada antes, devolviendo un array vacío.

**Falta todo:**

- D-22 Sistema de coordenadas (cartesiano, hexagonal, provincias con nombre).
- D-23 Tamaño del mapa y número de territorios.
- D-24 Tipos de terreno y sus modificadores (económicos y defensivos).
- D-25 Asignación inicial de territorios a cada reino y a los bots.
- D-26 Fórmula de distancia entre reinos (necesaria para el Bloque 9, ver §4.F).

### 4.E Batallas y resolución de combate (Bloque 7)

**Qué existe:** nada. El PDF recoge, como documentación anterior pendiente de confirmar, estos pesos: número 30 %, entrenamiento 20 %, armas 15 %, armadura 10 %, formación 10 %, moral 5 %, alimentación 5 %, fatiga 5 %.

- D-27 ¿La fórmula de pesos sigue vigente? ¿Cómo se calcula cada factor (qué es "armas" y "armadura" si no hay tecnologías ni herrería definidas)?
- D-28 Valores de ataque, defensa y velocidad por tipo de unidad.
- D-29 Cálculo de bajas por bando y por ronda; número de rondas.
- D-30 Condiciones de victoria, derrota y empate.
- D-31 Botín: qué porcentaje de recursos se transfiere y si hay límite por capacidad de carga.
- D-32 Estructura del informe de batalla (tabla `Battle`) que debe verse en la interfaz.
- D-33 Combate PvE contra bots: ¿existen bots? ¿Cómo se generan sus ejércitos?

### 4.F Parlamento y desafíos (Bloque 9)

**Qué existe:** la máquina de estados está cerrada en `docs/BLOQUE_9.txt` (PENDING → ACCEPTED / REJECTED → FROZEN → RESOLVED), sin código. Pendientes numéricos declarados por el propio bloque:

- D-34 Fórmula y valores de la penalización de recursos por rechazar un desafío (P38).
- D-35 Duración exacta de las tres ventanas temporales de programación (P37–P38).
- D-36 Momento o umbral de congelación del contingente (P40).
- D-37 Reglas de apuestas: qué se apuesta (recursos, territorio), retención en escrow y transferencia al resolver.
- D-38 Fórmulas de tiempo de marcha y fatiga en función de la distancia (P41).
- D-39 Umbrales de aproximación y coste del espionaje (P42).
- D-40 Límite de desafíos simultáneos por reino y tiempos de espera (cooldown).
- D-41 Lista de mensajes predefinidos permitidos entre jugadores (P60).
- D-42 ¿Qué nivel de Parlamento se exige para desafiar o ser desafiado?

### 4.G Civilizaciones

**Qué existe:** el campo `civilization` en el esquema de reinos y su texto en la interfaz. No hay lista de civilizaciones ni bonificaciones. El PDF indica no aplicar bonificaciones automáticamente.

- D-43 Lista oficial de civilizaciones seleccionables.
- D-44 Bonificaciones o modificadores por civilización (si existen en la versión vigente) y a qué afectan.
- D-45 ¿Se elige al crear el reino y es inmutable?

### 4.H Economía: huecos que ya afectan al juego actual

- D-46 Producción por trabajador y día de madera, piedra, hierro y oro (solo la agricultura tiene tasa aprobada: 2/día).
- D-47 Regla de capacidad productiva por edificio: hoy la producción agrícola se limita por `calculateBuildingWorkerCapacity`, pero la capacidad por nivel es `null`.
- D-48 Inanición: cuando los alimentos llegan a cero, ¿qué ocurre (muertes, caída de moral, deserción)? El código avisa de que el estado de inanición no se persiste y pide regla antes de activar penalizaciones.
- D-49 Felicidad (`happiness`), moral militar (`militaryMorale`) y política fiscal (`taxPolicy`) existen como campos sin ninguna fórmula.
- D-50 Crecimiento o descenso de la población: ¿hay natalidad, inmigración o límite por capacidad residencial?
- D-51 Salarios militares (citados como pendientes en el PDF §9).

---

## 5. Observaciones técnicas (sin cambios aplicados)

1. `convex/kingdoms.ts` y `convex/buildings.ts` exportan **ambos** `getConstructionState`, `startConstruction` y `cancelConstruction` con lógica duplicada. Conviene decidir cuál es la ruta canónica antes de añadir el entrenamiento.
2. `convex/buildingsCatalog.ts` y `convex/buildingsCalculations.ts` son código sin uso (ver §3). Si se descartan sus valores, deberían eliminarse para que no se confundan con reglas oficiales.
3. `trainingQueue` está en el esquema pero ningún módulo la escribe ni la lee.
4. La comprobación de tipos (`npm run lint`) pasa y la batería económica (`scripts/runEconomicTests.ts`) supera sus 61 pruebas en la rama actual.

---

## 6. Cómo entregar la información

Para cada decisión **D-xx**, basta una línea con la respuesta; para las tablas de §4.A y §4.B, las filas rellenadas. Cualquier parámetro que se deje en blanco seguirá bloqueado en el servidor con un mensaje explícito, nunca sustituido por un valor inventado.

Orden recomendado de implementación una vez recibida la información: D-01 a D-07 (desbloquea construcción con el código ya existente) → D-08 a D-15 (completa el entrenamiento iniciado en el último commit) → §4.C → §4.F junto con D-26 → §4.E → §4.D y §4.G → §4.H.
