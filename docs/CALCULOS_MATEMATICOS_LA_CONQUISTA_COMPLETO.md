# CÁLCULOS MATEMÁTICOS — LA CONQUISTA (COMPLETO)
Fecha: 2026-10-27

Este documento recopila las fórmulas, constantes y parámetros de balance del proyecto, extraídos del código fuente (Convex).

---

## 1. TIEMPO
- **Conversión**: 1 día real (86.400 s) = 1 año de juego.
- **Archivo**: `convex/balanceConfig.ts` (`export const TIME`)
- **Uso**: El código utiliza `SECONDS_PER_GAME_YEAR` para normalizar todas las duraciones y tasas productivas.

---

## 2. ECONOMÍA
- **Producción (por trabajador/día real)**:
  - Agricultura: 2.0
  - Madera: 1.0
  - Piedra: 0.75
  - Hierro: 0.4
  - Oro: 0.2
- **Consumo de alimentos**: 1 ración/habitante · día. Tropas regulares: 1.05x.
- **Archivo**: `convex/balanceConfig.ts` (`PRODUCTION_PER_WORKER_PER_DAY`, `FOOD`)

---

## 3. CONSTRUCCIÓN
- **Coste (nivel n)**: `redondear(base * 1.15^(n-1))`
- **Duración (nivel n)**: `ceil(baseDurationMs * (1 + 0.01)^(n-1) * durationModifier)`
- **Archivo**: `convex/buildingRules.ts` (`costsForTargetLevel`, `durationForTargetLevel`)

---

## 4. COMBATE
- **Fórmula de Potencia**: 
  `FactorPotencia = (Atributo ^ Exponente) * (Formación ^ Exponente) * Común * Contramedida`
- **Exponentes (`COMBAT.EXPONENTS`)**:
  - Número: 0.85
  - Entrenamiento: 0.6
  - Armas: 0.45
  - Armadura: 0.3
  - Formación: 0.3
  - Moral: 0.15
  - Alimentos: 0.15
  - Fatiga: 0.15
- **Archivo**: `convex/battleRules.ts` (`computeSideFactors`)

---

## 5. MISIONES
- **Estructura**: `STAGES` (etapas progresivas), `DAILY` (diarias), `SECRET` (ocultas).
- **Archivo**: `convex/balanceConfig.ts` (`MISSIONS`)

---

## Estatus de Implementación
- **Implementado**: Economía base, población, edificios, entrenamiento, combate.
- **Configurado (no activo)**: Estaciones (`SEASONS.ENABLED_EFFECTS = false`).
- **Pendiente**: Singularidades de civilizaciones, detalles finales de formaciones tácticas.
