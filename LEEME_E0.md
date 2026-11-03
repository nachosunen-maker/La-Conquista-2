# LA CONQUISTA — ENTREGA 0 (E0): CORRECCIONES PREVIAS DEL ÁRBOL TECNOLÓGICO

**Fecha:** 3 de noviembre de 2026  
**Proyecto:** La Conquista — Motor de Estrategia Medieval (Convex + React)  
**Estado de la entrega:** E0 implementada, verificada y empaquetada.

---

## 1. Resumen de la Entrega 0

Esta entrega prepara el terreno técnico antes de incorporar los nuevos nodos del árbol tecnológico:
1. **Ranura única de investigación:** Se fija a 1 sola investigación activa para todos los niveles de Universidad (`RESEARCH_SLOTS_BY_UNIVERSITY` todas en 1 y `RESEARCH.MAX_SLOTS = 1`).
2. **Requisitos oficiales P24:**
   - `medicine_1` («Cataplasmas y huertos medicinales»): Pasa a requerir **Castillo 2 + Universidad 2** (nivel de Universidad 2).
   - `advanced_steel` («Acero al crisol y caldeado»): Pasa a requerir **Universidad 3** (manteniendo Castillo 5 y Herrería 4).
3. **Conexión de los 10 efectos huérfanos:**
   - `combatAttackBonus` y `combatDefenseBonus` conectados a `BattleSide` y aplicados en `computeSideFactors` (`battleRules.ts`).
   - `marchSpeedBonus` y `marchFatigueReduction` conectados a `marchTimeSeconds` y `marchFatigue` (`territoryRules.ts`).
   - `parliament.ts`: Inyección de bonificaciones tecnológicas a las batallas PvP y bots mediante `snapshotSide`.
   - `bots.ts`: Corrección del chequeo de espionaje para utilizar `modifiers.espionageLevel` (0, 1 o 2).
4. **Batería de pruebas puras:** Creación de `convex/technologyPureTests.ts` con 6 comprobaciones de integridad matemática.

---

## 2. Archivos modificados y creados

| Archivo | Estado | Descripción de los cambios |
| :--- | :--- | :--- |
| `convex/balanceConfig.ts` | Modificado | Ranuras fijadas a 1 (`RESEARCH_SLOTS_BY_UNIVERSITY` y `RESEARCH.MAX_SLOTS = 1`); requisitos P24 para `medicine_1` y `advanced_steel`. |
| `convex/bots.ts` | Modificado | Usa `computeTechnologyModifiers(completedTech).espionageLevel` para habilitar el espionaje I y II sobre bots. |
| `convex/battleRules.ts` | Modificado | Añade `combatAttackBonus` y `combatDefenseBonus` a `BattleSide` y los aplica a la potencia de combate en `computeSideFactors`. |
| `convex/parliament.ts` | Modificado | Pasa modificadores de tecnología a `marchTimeSeconds` en `acceptChallenge` y a `BattleSide` en `snapshotSide`. |
| `convex/territoryRules.ts` | Modificado | Modifica `marchTimeSeconds`, `marchFatigue` y `calculateArmyMarchPlan` para admitir `techSpeedBonus` y `techFatigueReduction`. |
| `convex/technologyPureTests.ts` | Creado | Suite pura con 6 pruebas deterministas de ranuras, requisitos P24, combate, marcha, espionaje e integridad del catálogo. |
| `LEEME_E0.md` | Creado | Este documento explicativo de entrega y rollback. |

---

## 3. Cómo probar esta entrega paso a paso (desde el navegador)

1. **Ranura única de investigación:**
   - Entra en tu reino y accede a la pestaña **🎓 Universidad**.
   - Inicia cualquier tecnología disponible (por ejemplo, *Rotación de cultivos*).
   - Comprueba que entra en estado «En curso». Si intentas pulsar en otra investigación, el servidor devolverá el mensaje: *"No hay ranuras de investigación libres (1 con Universidad nivel X)"*.
2. **Requisitos P24 de Cataplasmas y Acero:**
   - En la Universidad, localiza *Cataplasmas y huertos medicinales*. Comprueba que exige **Castillo nivel 2** y **Universidad nivel 2**.
   - Localiza *Acero al crisol y caldeado*. Comprueba que exige **Universidad nivel 3** (junto con Castillo 5 y Herrería 4).
3. **Espionaje en Bots militares:**
   - Ve a **🏛️ Parlamento** e ingresa en el panel de monarcas/bots.
   - Con *Red de confidentes I* investigada, solicita el espionaje de cualquier monarca; el informe se generará sin errores.
4. **Verificación técnica local:**
   - Ejecuta `npm test`: comprobarás que se superan las 214 pruebas sin fallos.
   - Ejecuta `npm run lint`: 0 errores de TypeScript en cliente y servidor.

---

## 4. Cómo volver atrás (Rollback)

Si deseas revertir los cambios de E0 y volver al estado previo:
1. Restaura los archivos modificados desde la carpeta de respaldo `convex_backup/`:
   - Copia `convex_backup/balanceConfig.ts` a `convex/balanceConfig.ts`.
   - Copia `convex_backup/battleRules.ts` a `convex/battleRules.ts`.
   - Copia `convex_backup/parliament.ts` a `convex/parliament.ts`.
   - Copia `convex_backup/territoryRules.ts` a `convex/territoryRules.ts`.
   - Copia `convex_backup/technologyPureTests.ts` a `convex/technologyPureTests.ts`.
2. En `convex/bots.ts`, revierte las líneas que importan y usan `computeTechnologyModifiers`.
3. Ejecuta `npm test` para confirmar que el entorno vuelve a su estado anterior.
