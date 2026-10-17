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
| F. Combate y batallas (D-27 a D-32) | Implementado con dos límites de balance (§3) | `battleRules.ts`, `parliament.ts` | 7 |
| G. Mapa y territorios (D-22 a D-26) | Implementado | `territoryRules.ts`, `territories.ts` | 6 |
| H. Civilizaciones (D-43 a D-45) | Implementado | `civilizations.ts` | — |
| Interfaz P64 | Implementada (ver commit de interfaz) | `src/components/*` | tipado |

Batería completa: 104 pruebas puras (`npm test`), comprobación de tipos de `src/` y de `convex/` (`npm run lint`).

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

## 3. Límites de balance detectados (requieren decisión)

Las pruebas los documentan con el detalle numérico; el código respeta los valores aprobados sin alterarlos.

- **B-01 Techo de bajas.** Con k = 0,18 y 3 rondas, las bajas máximas de un bando en una batalla son 1 − 0,82³ = 44,9 %. Por tanto la retirada al 70 % y la victoria aplastante del 75 % (P47) **no pueden ocurrir**, y las reclamaciones de territorio (P48) nunca se conceden. Opciones: subir k, subir el número de rondas, o rebajar los umbrales.
- **B-02 Empates dominantes.** Con exponentes 0,20/0,15/0,10/0,05 y tolerancia de empate de 10 puntos, 1.000 soldados de élite (nivel 5, acero avanzado, acero, moral 95, ración excelente) contra 1.000 reclutas con palos, sin armadura, moral 30, ración mínima y fatiga 80 % terminan en **empate**. P34/P69 exigen que la preparación pueda vencer al número. Opciones: aumentar los exponentes de calidad, reducir la tolerancia de empate, o usar la puntuación lineal normalizada del Complemento.

---

## 4. Reglas derivadas que conviene confirmar (`[DERIVADO]`)

| Id | Regla aplicada | Dónde |
|---|---|---|
| R-01 | Edificios fundacionales: Castillo 1, Viviendas 20, Granja 11, Aserradero 4, Cantera 4, Mina de hierro 2, Mina de oro 1 (`nivel = ceil(trabajadores iniciales / capacidad por nivel)`), para que P19 se cumpla con la capacidad D-47. | `INITIAL_BUILDINGS` |
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
| R-12 | Las murallas solo condicionan el ×1,8 del asedio; no hay valor oficial de defensa por nivel de muralla (se deja en 0). | `COMBAT` |
| R-13 | Deserción (fase 3) retira tropa viva empezando por los lotes más numerosos; muertes civiles salen primero de la reserva libre. | `economy.ts` |
| R-14 | Fatiga de marcha calculada con terreno neutro (multiplicador 1) hasta definir el terreno intermedio. | `parliament.ts` |

---

## 5. Pendiente sin valor oficial (bloqueado explícitamente, no inventado)

- **Honor y gloria por batalla (P50-P51):** el informe registra 0 con marca `pending`. Solo existe el bonus diario +5 (P59).
- **Mercenarios (P53) y Taberna:** sin coste ni reglas; el edificio existe sin efecto.
- **Supervisores (P25):** sin reglas de formación; las ranuras de investigación quedan en 1.
- **Descanso y horarios (P15), estaciones y clima (P3), modo «A tope» (P55):** cualitativos en la Maestra; sin fórmulas.
- **Efectos de Herrería, Mercado, Panadería, Hospital como edificios de trabajadores:** la capacidad laboral existe pero el oficio no produce nada definido (solo el Hospital actúa por nivel, P45).
- **Capacidad de almacenamiento:** la tecnología `storage_1` acumula +10 % pero no hay tope de almacén base, así que no tiene efecto.
- **Profesiones de la Maestra sin oficio modelado (P13):** construcción, educación, medicina, religión, circo, feria como trabajadores.
- **Terreno intermedio en la marcha y apuestas de territorio (D-37).**
- **Bonificaciones por civilización (D-44) y revisión del nombre "Indios americanos".**

---

## 6. Observaciones técnicas

1. `kingdoms.ts` reexporta la construcción desde `buildings.ts`; la interfaz sigue llamando a `kingdoms:startConstruction`.
2. `npx convex codegen` exige un despliegue; `scripts/regenerateConvexApi.mjs` regenera `convex/_generated/api.d.ts` sin conexión. Al desplegar con `npx convex dev` se regenerará automáticamente.
3. La liquidación (`settleRelationalKingdomEconomy`) completa obras, lotes e investigaciones vencidas aunque el scheduler no se haya ejecutado, y aplica recursos, población, bienestar, heridos y fatiga en una sola transacción.
4. Ningún cambio se ha desplegado al backend remoto; todo es local en la rama.
