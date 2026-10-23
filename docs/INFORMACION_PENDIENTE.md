# LA CONQUISTA — Estado de implementación y decisiones pendientes

**Fecha:** 2026-10-17
**Rama:** `ccr-5630b85b-8bybdp`
**Fuentes:** `docs/Especificacion_Maestra_P1-P73.txt` (reglas oficiales), `docs/Complemento_Datos_Pendientes.txt` (valores de balance aprobados para carga el 17-10-2026), `docs/BLOQUE_9.txt`.
**Decisiones del responsable (17-10-2026):** cargar todo el Complemento; D-51 opción B (sin salario militar); D-33 sin bots PvE.

Todos los valores viven en `convex/balanceConfig.ts` con su origen etiquetado: `[MAESTRA Pnn]`, `[COMPLEMENTO]` o `[DERIVADO]` (regla calculada a partir de las anteriores, pendiente de confirmación). Ningún número está disperso en la lógica (P72).

---

## 1. Resumen por bloque

| Bloque | Estado | Módulos | Pruebas |
|---|---|---|---|
| A. Edificios y construcción (D-01 a D-07) | Implementado | `buildingRules.ts`, `buildings.ts` (ruta canónica; `kingdoms.ts` reexporta) | 15 |
| B. Ejército y entrenamiento (D-08 a D-15) | Implementado | `armyRules.ts`, `army.ts` | 9 |
| C. Tecnologías (D-16 a D-21) | Implementado | `technologyRules.ts`, `technologies.ts` | 6 |
| D. Economía ampliada (D-46 a D-51) | Implementado | `economyExtended.ts`, `economy.ts` | 7 |
| E. Parlamento y desafíos (D-34 a D-42) | Implementado | `challengeRules.ts`, `parliament.ts` | 5 |
| F. Combate y batallas (D-27 a D-32) | Implementado y recalibrado (§3) | `battleRules.ts`, `parliament.ts` | 8 |
| G. Mapa y territorios (D-22 a D-26) | Implementado | `territoryRules.ts`, `territories.ts` | 6 |
| H. Civilizaciones (D-43 a D-45) | Implementado | `civilizations.ts` | — |
| Interfaz P64 | Implementada: pestañas Aldea/Ejército/Universidad/Parlamento/Mapa, asistente de fundación P4-P9, insignia P58 | `src/App.tsx`, `src/components/*` | lint y build |

Batería completa: 111 pruebas puras (`npm test`), 11 pruebas de integración sobre convex-test (`npm run test:integration`), banco de simulaciones de combate (`npm run simulate:battles`) y comprobación de tipos de `src/` y de `convex/` (`npm run lint`).

---

## 2. Decisiones aplicadas (D-01 a D-51)

| Decisión | Cómo se aplicó |
|---|---|
| D-01 | `buildingsCatalog.ts` y `buildingsCalculations.ts` eliminados; la tabla del Complemento §2 (18 edificios) está en `BUILDINGS`. |
| D-02 | `coste(n) = round(base × 1,15^(n−1))` en `costsForTargetLevel`. |
| D-03 | Capacidad lineal `base × nivel`, sumando edificios del mismo oficio. |
| D-04 | Reembolso fijo del 50 % al cancelar obra, lote o investigación. |
| D-05 | Ningún edificio supera el nivel del Castillo (el Castillo exento). |
| D-06 | Prerrequisitos del Complemento §2. |
| D-07 | Mina de oro habilita el oficio `gold` (50 trabajadores/nivel, 0,20 oro/día). |
| D-08 | Duración por unidad del Complemento §3; lote = duración × cantidad. |
| D-09 | 1 cola con Cuartel 1-2, +1 cada 3 niveles, máximo 4. |
| D-10 | Cancelar devuelve 50 % de recursos y toda la población reservada. |
| D-11 | `armyUnits` es la fuente única; la tabla heredada `Armyunits` se migra al leerla desde una mutación y se borra tras migrar (D-15). `regular` → infantería nivel 1. |
| D-12 | Las máquinas de asedio no consumen; sus 5 operadores por pieza se reservan de la población civil y consumen con el factor 1,05. El interruptor de la interfaz se retiró. |
| D-13 / D-14 | Niveles 1-5 con multiplicadores P29 y requisitos P23; `cuartel` = Barracones. El nivel se elige al entrenar y se guarda por lote (`armyUnits.level`). |
| D-16 a D-21 | Catálogo de 13 tecnologías; progreso en `technologyProgress`; 1 ranura (máximo 3 con supervisores, sistema no implementado); efectos idempotentes; completado programado y salvaguarda en liquidación. |
| D-22 a D-26 | Mapa axial radio 10 (331 celdas), terrenos con modificadores, territorio principal por reino, distancia hexagonal, marcha 1.800 s/hex y fatiga +2/hex con recuperación 10/día. |
| D-27 a D-30 | Simulador determinista: potencia multiplicativa con exponentes del Complemento, 3 rondas, k = 0,18, retirada 70 % o moral < 20, empate ±10 pp. |
| D-31 / D-33 | Sin botín; sin bots. |
| D-32 | Tabla `Battle` con el informe completo P43 (factores, rondas, bajas, heridos, explicación generada de los factores reales). |
| D-34 a D-42 | Penalización 2 % (10-500), ventanas 1/3/7 días, congelación 15 min antes, 3 pendientes máximo, 24 h por rival, mensajes P60, Parlamento nivel 1, espionaje ±25/15/7 % a 100/250 oro con caducidad de 24 h, sin apuestas. |
| D-43 a D-45 | Doce civilizaciones P6, elegidas al fundar, inmutables, sin bonificaciones. |
| D-46 / D-47 | Tasas por trabajador del Complemento; `efectivos = min(asignados, capacidad de edificios completados)`. |
| D-48 | Déficit acumulado persistido en `population.starvationSeconds`; fases 1/2/3 con los efectos del Complemento; se reinicia cuando las reservas vuelven a cubrir el intervalo. |
| D-49 | Felicidad y moral 0-100 (inicial 70), tramos impositivos, fórmula de moral del Complemento. |
| D-50 | `P_objetivo = floor(P × 1,30^t)` con t en años de juego (continuo), limitado por viviendas; los nacimientos van a la reserva civil libre. |
| D-51 | Opción B: sin salario militar (`TRAINING.MILITARY_SALARY_ENABLED = false`). |

---

## 3. Balance del combate: decisiones aplicadas (ronda 2, 17-10-2026)

El responsable aprobó seguir las recomendaciones del documento de decisiones. Valores vigentes en `COMBAT`:

| Punto | Antes | Ahora | Efecto comprobado con `npm run simulate:battles` (964 enfrentamientos) |
|---|---|---|---|
| B-01 techo de bajas | k = 0,18 (techo 44,9 %) | **k = 0,40** (techo 78,4 %) | 5.000 contra 300 produce retirada y victoria aplastante; las victorias aplastantes solo aparecen con desequilibrios enormes. |
| B-02 calidad frente a número | exponentes 0,20/0,15/0,10/0,05; empate ±10 pp | **exponentes entrenamiento 0,6, armas 0,45, armadura 0,3, formación 0,3, moral/ración/fatiga 0,15; empate ±5 pp** | 600 soldados de élite derrotan a 1.000 reclutas mal preparados; fuerzas idénticas empatan el 100 % de las veces; a partir del 60 % de proporción la élite gana siempre. |

Resultados completos del banco (escenarios del Complemento §6): fuerzas iguales 100 % empate; pequeño y preparado contra grande y mal preparado 29,6 % victoria / 58,3 % derrota / 12 % empate en todas las proporciones y 100 % victoria con proporción ≥ 60 %; horda con mala moral y fatiga contra 1.000 descansados 66,7 % victoria de la horda; barrido de equipo y entrenamiento 65,6 % victoria del mejor equipado. Ejecutar el banco tras cualquier cambio de `COMBAT`.

## 4. Reglas derivadas ratificadas (`[DERIVADO]`, aprobadas el 17-10-2026 con las recomendaciones del documento de decisiones)

| Id | Regla aplicada | Dónde |
|---|---|---|
| R-01 | **Ratificada (opción A).** Edificios fundacionales: Castillo 1, Viviendas 20, Granja 11, Aserradero 4, Cantera 4, Mina de hierro 2, Mina de oro 1 (`nivel = ceil(trabajadores iniciales / capacidad por nivel)`), para que P19 se cumpla con la capacidad D-47. Alternativa: solo Castillo 1 (incumple P19 hasta construir granjas). | `INITIAL_BUILDINGS` |
| R-02 | Base imponible = unidades producidas de alimentos, madera, piedra y hierro en el intervalo; `oro = base × tasa`. El oro minado no tributa. | `economyExtended.ts` |
| R-03 | Las tecnologías de felicidad elevan el nivel de equilibrio (70 + bonus) y recuperan 1 punto/día hasta alcanzarlo. | `economyExtended.ts` |
| R-04 | Contribuciones diarias de felicidad: ración (−2/0/+1/+2), hacinamiento −2, iglesia +1, circo +1. | `WELLBEING` |
| R-05 | Moral: bonus por ración (−10/0/+3/+5), victoria +5 y derrota −5 durante 7 días reales. | `MORALE` |
| R-06 | Territorio principal: el primer reino en el centro; los siguientes en la celda libre más alejada de los existentes (determinista). Terrenos por hash con pesos 30/25/20/15/10 y costa solo en el borde. | `territoryRules.ts` |
| R-07 | Territorio "cercano" reclamable: distancia ≤ 2 de un territorio propio. | `CLAIM_MAX_DISTANCE` |
| R-08 | Estrategias (P35): defensiva 0,9/1,2, agresiva 1,25/0,8, concentración 1,1/1,0; contrarrestar ×1,15; límite 0,80-1,25. Ciclo: defensiva vence a agresiva, agresiva a concentración, concentración a defensiva. | `STRATEGIES` |
| R-09 | Desbloqueo de equipo: palo libre; lanza con Herrería 1; espada de hierro con Herrería 2 + Mina 1; acero con Herrería 4 + Metalurgia; acero avanzado con Acero avanzado; armaduras análogas. | `EQUIPMENT_UNLOCKS` |
| R-10 | Un desafío pendiente caduca a los 7 días reales sin respuesta. | `PENDING_EXPIRY_MS` |
| R-11 | Desgaste de equipamiento informado como porcentaje de bajas propias (sin regla numérica oficial). | `battleRules.ts` |
| R-12 | Las murallas condicionan el ×1,8 del asedio y añaden **+5 % de defensa por nivel (máximo +50 %)** (M-06 opción A). | `COMBAT.WALLS_DEFENSE_PER_LEVEL` |
| R-13 | Deserción (fase 3) retira tropa viva empezando por los lotes más numerosos; muertes civiles salen primero de la reserva libre. | `economy.ts` |
| R-14 | Fatiga de marcha calculada con terreno neutro (multiplicador 1) hasta definir el terreno intermedio. | `parliament.ts` |

---

## 5. Mecánicas de la ronda 2 (decisiones M-01 a M-11 aplicadas el 17-10-2026)

| Decisión | Aplicación |
|---|---|
| M-01 honor y gloria (opción A) | Victoria +20/+10, aplastante +50/+30, empate +5/0, derrota 0/−5 (gloria nunca < 0). La gloria decae 1 punto/día real y da +1 moral por cada 10 (máximo +10). `BATTLE_REWARDS`. |
| M-02 mercenarios (opción A) | `army:hireMercenaries`: 25 oro por mercenario (infantería nivel 2), hasta 50 activos por nivel de Taberna, contrato de 7 días reales, salario 1 oro/día liquidado en la economía; si no hay oro desertan; no generan natalidad. `MERCENARIES`. |
| M-03 supervisores (opción B) | Ranuras de investigación por nivel de Universidad: 1 (nivel 1-2), 2 (3-4), 3 (5+). `RESEARCH_SLOTS_BY_UNIVERSITY`. |
| M-04 descanso (opción A) | `economy:setRestPolicy`: normal; intensiva (+15 % producción, −3 felicidad/día, +5 fatiga/día, equivale al modo «A tope»); relajada (−10 %, +2, −5). `REST_POLICIES`. |
| M-05 estaciones (opción B) | Estación informativa en `kingdoms:getKingdomFull.season` (cuatro por año de juego). Los modificadores de la opción A están en `SEASONS` desactivados (`ENABLED_EFFECTS = false`). |
| M-06 murallas y almacén (opción A) | Murallas +5 %/nivel (máx. +50 %). Almacén: 10.000 por recurso + 2.000 por nivel de Mercado, ×1,10 con Almacenes reforzados; el excedente producido se pierde, las reservas previas no. `STORAGE`. |
| M-07 profesiones (opción A) | medicina +1 pp de recuperación por 10 trabajadores (tope +10); religión y circo +1 felicidad/día por 20 (tope +3 cada una); panadería −5 % de consumo por 20 (tope −15 %); construcción −1 % de duración de obras por 10 (tope −20 %). Limitadas por la capacidad del edificio. Oficios asignables ampliados. `PROFESSION_EFFECTS`. |
| M-08 apuestas | Se mantienen desactivadas (opción A). |
| M-09 civilizaciones | Nombres decididos el 21-10-2026: «Indios americanos» → Navajos y «Keniatas» → Masáis (identificadores antiguos migrados de forma perezosa). |
| M-10 bots PvE | Sin bots (opción A); siguiente paso lógico una vez calibrado el combate. |
| M-11 formación (opción A) | Matriz de contrapartidas caballería > arqueros > infantería > caballería (+25 % contra el tipo contrarrestado, proporcional a su presencia) y fracción de participación por tipo (`army:setFormation`). `UNIT_COUNTERS`, `COMBAT.FORMATION_COUNTER_BONUS`. |

### Sigue sin valor oficial
- R-14 (decisión 23-10-2026): la marcha usa la media del terreno de las celdas del camino, en Parlamento y en el mapa (`pathTerrainMultiplier`). Los multiplicadores por terreno de `TERRAINS.marchMultiplier` siguen todos en 1,0: sin valor oficial hasta aprobación. Apuestas de territorio (M-08) desactivadas.
- Bots PvE (M-10), descartados por decisión.
- Implementado en código local el 23-10-2026, con valores `[DERIVADO]` pendientes de aprobación: formaciones tácticas (`TACTICAL_FORMATIONS`, contramedida ×1,15), tipos de mercenarios (`MERCENARIES.TYPES`), misiones (`MISSIONS`: 4 etapas, 3 diarias/día con reinicio 00:00 UTC, secretas 1 por civilización) y singularidades de civilización (`CIVILIZATION_IDENTITIES`, debilidades en `passive.weakness`/`trainingCostByUnit`). Navajos y Masáis siguen sin identidad ni debilidad (no se inventan).
- Inicio de sesión (T-01, 22-10-2026): implementado en código local por nombre de gobernante + contraseña con Convex Auth (`convex/auth.ts`, `convex/http.ts`, `convex/account.ts`) y código de recuperación mostrado una sola vez. Pendiente de aprobar el formato del código (16 símbolos en 4 grupos, 5 intentos y 15 min de bloqueo, `ACCOUNT.RECOVERY_CODE`, marcado `[DERIVADO]`) y de configurar en el panel de Convex las variables `JWT_PRIVATE_KEY`, `JWKS` y `SITE_URL` al desplegar (sin autorización todavía).

> **23-10-2026:** la lista actualizada de valores y puntos pendientes de aprobación está en `docs/DEFINICIONES_PENDIENTES.md`.

## 6. Observaciones técnicas

1. `kingdoms.ts` reexporta la construcción desde `buildings.ts`; la interfaz sigue llamando a `kingdoms:startConstruction`.
2. `npx convex codegen` exige un despliegue; `scripts/regenerateConvexApi.mjs` regenera `convex/_generated/api.d.ts` sin conexión. Al desplegar con `npx convex dev` se regenerará automáticamente.
3. La liquidación (`settleRelationalKingdomEconomy`) completa obras, lotes e investigaciones vencidas aunque el scheduler no se haya ejecutado, y aplica recursos, población, bienestar, heridos y fatiga en una sola transacción.
4. Ningún cambio se ha desplegado al backend remoto; todo es local en la rama.
5. Las pruebas de integración usan `convex-test` con el reloj simulado (`vi.useFakeTimers`) para completar obras, lotes, investigaciones y desafíos programados sin esperar tiempo real.
