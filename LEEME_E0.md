# LA CONQUISTA — ENTREGA 0 (E0 FINAL): PREPARACIÓN DEL ÁRBOL TECNOLÓGICO

**Fecha:** 3 de noviembre de 2026  
**Proyecto:** La Conquista — Motor de Estrategia Medieval (Convex + React)  
**Estado de la entrega:** E0 implementada, verificada y empaquetada (219/219 pruebas superadas).

---

## 1. Resumen de la Entrega 0 (Final)

1. **Ranura única de investigación:** Se fija exactamente 1 investigación activa en todos los niveles de Universidad (`RESEARCH_SLOTS_BY_UNIVERSITY` todas en 1 y `RESEARCH.MAX_SLOTS = 1`).
2. **Requisitos oficiales P24:**
   - `medicine_1` («Cataplasmas y huertos medicinales»): Pasa a requerir **Castillo 2 + Universidad 2**.
   - `advanced_steel` («Acero al crisol y caldeado»): Pasa a requerir **Universidad 3** (manteniendo Castillo 5 y Herrería 4).
3. **Conexión de los 10 efectos huérfanos:**
   - `combatAttackBonus` y `combatDefenseBonus` conectados a `BattleSide` y aplicados en `computeSideFactors` (`battleRules.ts`).
   - `marchSpeedBonus` y `marchFatigueReduction` conectados a `marchTimeSeconds` y `marchFatigue` (`territoryRules.ts`).
   - Inyección en Parlamento y bots del nivel de espionaje y bonificaciones de combate.
4. **Restauración y Desglose de Pruebas:**
   - Suite `convex/technologyPureTests.ts` con **11 pruebas desglosadas e independientes** (6 de E0 + 3 restauradas + 2 por separación de idempotencia, heridos al 60% y niveles iniciales contra `INITIAL_BUILDINGS`).
   - Total de pruebas en la suite global: **219 pruebas indivisibles** (219/219 superadas).
5. **Documento Maestro:**
   - Guardado completo en `docs/ARBOL_TECNOLOGICO.md` (112 IDs de nodos nuevos, 8.760 bytes).

---

## 2. Archivos Modificados y Creados en E0 Final

| Archivo | Estado | Descripción de los cambios |
| :--- | :--- | :--- |
| `convex/balanceConfig.ts` | Modificado | Ranuras fijadas a 1; requisitos P24 para `medicine_1` y `advanced_steel`. |
| `convex/battleRules.ts` | Modificado | Conexión de `combatAttackBonus` y `combatDefenseBonus` en `computeSideFactors`. |
| `convex/parliament.ts` | Modificado | Pasa modificadores tecnológicos a batallas PvP/PvE y marchas. |
| `convex/territoryRules.ts` | Modificado | Modifica `marchTimeSeconds` y `marchFatigue` para admitir bonificaciones de velocidad y resistencia (`logistics_1`). |
| `convex/technologyPureTests.ts` | Creado | Suite de 11 pruebas de tecnología (E0 + restauradas + desglosadas). |
| `convex/economyPureTests.ts` | Modificado | Eliminada llamada duplicada para mantener el recuento global limpio en 219. |
| `scripts/runEconomicTests.ts` | Modificado | Runner global integrado con las 11 pruebas de tecnología. |
| `docs/ARBOL_TECNOLOGICO.md` | Creado | Documento maestro con los 112 IDs nuevos y sección de decisiones confirmadas. |
| `CLAUDE.md` | Modificado | Nombres canónicos de Navajos y Masáis con alias de retrocompatibilidad. |
| `LEEME_E0.md` | Modificado | Guía explicativa y resumen final de entrega y rollback. |

---

## 3. Paquete ZIP de Entrega 0 Final

- **Ruta:** `/.aistudio/artifacts/brain/496cd4f1-0c51-4d12-bab3-0941aaa1583d/la-conquista-e0-final.zip`
- **Tamaño:** `13.208.900 bytes` (~13,2 MB)
- **Filtros aplicados:** Excluye estrictamente `node_modules`, `.git`, `.vite`, `dist`, `.aistudio`, `tmp` y archivos `.env*` y `.zip`.

---

## 4. Instrucciones de Verificación Local

1. Ejecutar `npm test`: Confirmar que se superan las **219 pruebas puras** en ~60 ms.
2. Ejecutar `npm run lint`: Confirmar 0 errores de compilación TypeScript.
