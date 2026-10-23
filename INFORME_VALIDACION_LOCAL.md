# INFORME DE VALIDACIÓN LOCAL — LA CONQUISTA

**Fecha de ejecución:** 23 de octubre de 2026  
**Proyecto:** La Conquista (Juego de estrategia medieval)  
**Entorno de ejecución:** Entorno local de desarrollo (Node.js + React + Convex local test runner)

---

## 1. Verificación del Entorno de Dependencias

Se comprobó el estado de las herramientas y archivos base del proyecto:

| Elemento | Estado / Versión | Observaciones |
| :--- | :--- | :--- |
| **Node.js** | `v22.23.3` | Compatible con el motor de ejecución y TypeScript. |
| **npm** | `10.9.9` | Gestor de paquetes oficial. |
| **package.json** | Presente | Declara dependencias y scripts de validación. |
| **package-lock.json** | Sincronizado | Corregido de forma segura sin alterar versiones principales. |
| **node_modules** | Presente | Dependencias locales instaladas y verificadas. |
| **Registro npm** | Conectividad confirmada | `npm ping` respondió `PONG 204ms`. |

### Diagnóstico y Resolución del Bloqueo de Dependencias
- **Diagnóstico:** Inicialmente, `npm ci --dry-run` reportó un desfase debido a que `@auth/core@0.41.3` y `@convex-dev/auth@0.0.96` habían sido incorporados a `package.json` en la fase de autenticación exclusiva por usuario y contraseña sin registrarse en `package-lock.json`.
- **Acción segura:** Se ejecutó `npm install --package-lock-only --legacy-peer-deps` para registrar exactamente las dependencias existentes sin actualizar versiones indiscriminadamente.
- **Verificación:** La prueba limpia `npm ci --dry-run --legacy-peer-deps` finalizó con **código de salida 0** en 522 ms.

---

## 2. Ejecución y Resultados de Pruebas Locales

Se ejecutaron de forma independiente todos los comandos de verificación y prueba declarados en `package.json`:

### A. Verificación de Tipos y Sintaxis (`npm run lint`)
- **Comando:** `tsc --noEmit && tsc --noEmit -p convex`
- **Código de salida:** `0` (Éxito)
- **Resultado:** Cero errores de sintaxis o tipado en el frontend React (`src/`) y en los módulos del backend Convex (`convex/`).

### B. Pruebas Unitarias y Económicas (`npm test`)
- **Comando:** `tsx scripts/runEconomicTests.ts`
- **Código de salida:** `0` (Éxito)
- **Total de pruebas:** **200 de 200 superadas** (0 fallidas)
- **Tiempo de ejecución:** 41 ms
- **Áreas evaluadas según Especificación Maestra:**
  - Equivalencia temporal: 1 día real = 1 año de juego.
  - Dinámica demográfica y producción efectiva por asignación de trabajadores.
  - Fases de alimentación, reservas, hambre e inanición.
  - Construcción de edificios, costes, tiempos y prerrequisitos.
  - Árbol de investigaciones y tecnologías exclusivas.
  - 12 Civilizaciones canónicas oficiales (equilibrio pasivo ≤ 15 %, singularidades aprobadas).
  - Integridad de cuenta por usuario y contraseña (normalización sin distinción de mayúsculas/acentos, hash seguro y código de recuperación de 16 caracteres de un solo uso).
  - Sistema de misiones (etapas progresivas, diarias con reinicio UTC y secretas).

### C. Pruebas de Integración (`npm run test:integration`)
- **Comando:** `vitest run`
- **Código de salida:** `0` (Éxito)
- **Total de pruebas:** **40 de 40 superadas** en 3 archivos de prueba (0 fallidas)
- **Tiempo de ejecución:** 8.15 s
- **Detalle de suites:**
  - `convex/account.test.ts` (6 pruebas): Creación de cuenta con usuario/contraseña, unicidad de nombre de gobernante, sesiones múltiples, rechazo de contraseñas cortas (<8 car.), emisión e invalidación del código de recuperación y bloqueo tras 5 intentos fallidos.
  - `convex/integration.test.ts` (28 pruebas): Flujo integral de reino, ticks temporales, almacenes, cuartel, instrucción de tropas y mercenarios.
  - `convex/missions.test.ts` (6 pruebas): Otorgamiento determinista de recompensas, control de duplicados y misiones de civilización.

### D. Banco de Simulación de Batallas (`npm run simulate:battles`)
- **Comando:** `tsx scripts/simulateBattles.ts`
- **Código de salida:** `0` (Éxito)
- **Enfrentamientos simulados:** **1.252 combates**
- **Resultados de calibración:**
  - Fuerzas idénticas: 100 % empates garantizados dentro del margen de ±5 pp.
  - Ejércitos reducidos pero de alta tecnología vs hordas desorganizadas: victorias consistentes para la fuerza equipada en proporciones ≥ 60 %.
  - Asedios, murallas, fatiga de marcha y matriz de formaciones tácticas (ofensiva, defensiva, equilibrada, flanqueo) respetando los coeficientes canónicos del sistema de combate.

### E. Compilación de Producción (`compile_applet`)
- **Resultado:** `Build succeeded` (La aplicación compila correctamente para despliegue sin advertencias críticas).
- **Servidor local:** Activo y respondiendo con código HTTP `200` en el puerto 3000.

---

## 3. Garantías de Seguridad y Conservación

1. **Sin despliegues remotos:** No se ejecutó ninguna acción sobre despliegues remotos de Convex ni se transmitieron cambios a entornos de producción.
2. **Protección de datos:** El reino de demostración *Iberia* y la carpeta `convex_backup/` permanecen intactos.
3. **Privacidad de secretos:** Las variables de entorno `.env` y `.env.local` no se incluyen en este informe ni en el paquete comprimido.

---

## 4. Archivo de Distribución Generado

- **Nombre:** `la-conquista-validado.zip`
- **Ubicación:** Raíz del proyecto (`/app/applet/la-conquista-validado.zip`)
- **Contenido:** Código fuente completo, componentes React, módulos Convex, pruebas y documentación técnica.
- **Exclusiones aplicadas:** `node_modules/`, `.git/`, `.env*`, `.aistudio/`, `dist/`, `tmp/` y archivos comprimidos.
