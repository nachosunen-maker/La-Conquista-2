# Bloque Funcional de Exploración del Mapa y Territorios Libres (P22, P49)

## 1. Resumen Ejecutivo
Se ha desarrollado e integrado de forma completa el sistema autoritativo de **Exploración del Mapa y Niebla de Guerra**, dando cumplimiento exacto a los puntos **P22** (explorar) y **P49** (territorios libres accesibles mediante victorias aplastantes y exploración) de la Especificación Maestra de La Conquista.

---

## 2. Correspondencia Exacta con la Especificación Maestra

| Punto | Requisito Canónico | Implementación en este Bloque |
| :--- | :--- | :--- |
| **P22** | Explorar el mapa del mundo como decisión estratégica del soberano. | Mecánica autoritativa de expedición de reconocimiento con costes de suministros (oro y comida), asignación de 1 explorador civil y tiempo de marcha canónico. |
| **P48** | Tras una gran victoria se puede reclamar un territorio libre cercano (distancia ≤ 2). | Se actualizó la regla de reclamación para exigir que el territorio haya sido previamente explorado y cartografiado por el reino. |
| **P49** | Los territorios libres no pertenecen a ningún reino y se obtienen mediante victorias aplastantes y exploración. | Integración completa entre la exploración (que desvela la niebla de guerra, el terreno y el estatus libre) y la reclamación territorial con bonificaciones comarcales (D-24). |
| **D-22 / D-23** | Coordenadas axiales hexagonales `(q, r)` y radio 10 (331 celdas). | Se respeta estrictamente la geometría del mapa y el hash determinista de generación reproducible. |
| **D-26 / §5** | Tiempo de marcha canónico: $T_{\text{marcha}} = 1.800\text{ s por hexágono}$. | La duración de la expedición utiliza $1.800\text{ s} \times \text{distancia}$ hacia el objetivo. |
| **D-04 / D-21** | Reembolso del 50 % en cancelaciones. | Al cancelar una expedición en curso se recupera exactamente el 50 % de oro y comida y se libera inmediatamente al explorador. |

---

## 3. Arquitectura y Modelo de Datos

```
┌────────────────────────────────────────────────────────┐
│                    CONVEX BACKEND                      │
│                                                        │
│  ┌──────────────────┐          ┌───────────────────┐  │
│  │   territories    │          │exploredTerritories│  │
│  │(331 celdas mundo)│◄────────►│ (por reino/celda) │  │
│  └─────────┬────────┘          └───────────────────┘  │
│            │                                           │
│            ▼                                           │
│  ┌──────────────────┐          ┌───────────────────┐  │
│  │ explorationQueue │          │    population     │  │
│  │ (cola autorit.)  │◄────────►│ (reserva scouts)  │  │
│  └──────────────────┘          └───────────────────┘  │
│            ▲                                           │
│            │ (scheduler Convex & resolución a demanda) │
└────────────┼───────────────────────────────────────────┘
             │
┌────────────┴───────────────────────────────────────────┐
│                    INTERFAZ CLIENTE                    │
│  - MapPanel.tsx: niebla de guerra SVG, celdas         │
│    explorables en frontera, cuenta atrás de marcha,    │
│    leyenda D-24 y registro de hallazgos territoriales  │
└────────────────────────────────────────────────────────┘
```

---

## 4. Archivos Modificados y Creados

1. `convex/balanceConfig.ts`:
   - Declaración de constantes de balance `EXPLORATION` (costes base de raciones/oro, exploradores requeridos, radio inicial de visión y tiempo de marcha).
2. `convex/schema.ts`:
   - Incorporación de las tablas `exploredTerritories` (persistente por reino) y `explorationQueue` (ciclo de vida de expediciones en curso).
3. `convex/explorationRules.ts`:
   - Reglas puras sin efectos secundarios: cálculo de visión inicial (radio 1 = 7 celdas), comprobación de adyacencia de frontera, validación demográfica/económica, progreso porcentual, reembolso del 50 % y descubrimientos deterministas según terreno.
4. `convex/territoryRules.ts`:
   - Actualización de `canClaimTerritory` para exigir exploración previa (`exploredCellIds`).
5. `convex/territories.ts`:
   - Modificación de `getWorldMap` para soportar niebla de guerra por reino.
   - Mutaciones autoritativas `startExploration`, `cancelExploration`, `resolveCompletedExplorations` y mutación interna `completeExplorationScheduled`.
   - Modificación de `claimFreeTerritory` para verificar estado explorado.
6. `src/components/MapPanel.tsx`:
   - Visualización interactiva con niebla de guerra, celdas de frontera explorables (`🔭`), celdas en expedición con pulso (`🧭`), paneles de coste/tiempo y registro de descubrimientos recientes.
7. `convex/explorationPureTests.ts` y `scripts/runEconomicTests.ts`:
   - Batería de 15 pruebas puras de exploración y territorios integradas en la suite general (164 pruebas superadas al 100 %).
8. `convex/integration.test.ts`:
   - 3 pruebas de integración con backend simulado que verifican el ciclo completo: expedición, reserva/liberación de ciudadanos, compensación horaria, descubrimientos y reclamación P49 (14 pruebas de integración superadas al 100 %).
