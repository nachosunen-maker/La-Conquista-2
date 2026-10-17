# DOCUMENTO MAESTRO DE MEJORAS PENDIENTES — LA CONQUISTA

**Fecha:** 17 de octubre de 2026  
**Proyecto:** La Conquista (Juego web de estrategia medieval)  
**Objeto:** Establecer el documento central para dirigir el trabajo restante hasta una versión verificable, robusta y preparada para su despliegue, consolidando los hallazgos de la Especificación Maestra P1–P73, `docs/INFORMACION_PENDIENTE.md`, `docs/AUDITORIA_COHERENCIA_P1_P73.md` y las decisiones aprobadas de la Ronda 2.

---

## 1. Verificación Documental y Estado Actual

El presente informe consolida el estado verificado del motor de La Conquista a partir de la auditoría documental y de código reciente. 
- **Verificado mediante código o pruebas:** Fundación de reinos (P4–P10), motor económico temporal y continuo (P2, P11–P18, D-46/D-47), catálogo de 18 edificios y cola de construcción (D-01 a D-07), gestión de tropas y entrenamiento (P23, P28, P29, D-08 a D-15), árbol tecnológico de 13 tecnologías (D-16 a D-21), mapa hexagonal axial y fatiga (D-22 a D-26), Parlamento y desafíos PvP (D-34 a D-42), y simulador determinista de combate recalibrado (Ronda 2).
- **Reportado por auditoría anterior:** 149 pruebas puras superadas y 11 pruebas de integración sobre `convex-test` ejecutadas sin fallos.
- **Pendiente de comprobación:** Verificación transaccional en el despliegue remoto real de Convex (`dev/laconquista`), pendiente hasta autorización expresa del administrador.
- **Decisión de diseño pendiente de aprobación:** Bonificaciones pasivas numéricas por civilización (M-09 / D-44), terreno intermedio de marcha (R-14) y apuestas de territorio (M-08).

---

## 2. Clasificación de tareas

- **P0 — Bloqueante:** 0 incidencias (seguridad, integridad y matemáticas verificadas en código y pruebas).
- **P1 — Necesario antes de publicar:** 0 incidencias pendientes de obligatoriedad funcional en la versión actual (todas las reglas de la especificación maestra y de la ronda 2 requeridas están implementadas).
- **P2 — Mejora funcional:** 2 tareas (ajustes menores de interfaz y nombres definitivos opcionales).
- **P3 — Mejora futura:** 2 tareas (refactorización opcional y optimización de renderizado en mapa).
- **DECISIÓN PENDIENTE:** 3 elementos (bonificaciones por civilización M-09, terreno de marcha R-14, apuestas M-08).

---

## 3. Campos Obligatorios por Tarea

### Tarea M-01 (P2 — Mejora funcional)
- **Identificador:** TASK-M01
- **Prioridad:** P2
- **Sistema afectado:** Civilizaciones / Interfaz
- **Regla P1–P73:** P6, D-43 a D-45 (M-09)
- **Evidencia concreta:** `convex/civilizations.ts`, `convex/balanceConfig.ts` (`CIVILIZATIONS`)
- **Problema y consecuencia jugable:** La civilización "Indios americanos" carece de un nombre etnológicamente preciso consensuado.
- **Solución propuesta:** Actualizar el nombre en `CIVILIZATIONS` previa aprobación de diseño.
- **Dependencias:** Ninguna técnica.
- **Criterio de aceptación:** Nombre aprobado reflejado en el asistente de fundación y en Convex sin romper claves existentes.
- **Pruebas necesarias:** `foundationPureTests.ts`
- **Estado:** Pendiente de aprobación.

### Tarea M-02 (P2 — Mejora funcional)
- **Identificador:** TASK-M02
- **Prioridad:** P2
- **Sistema afectado:** Mapa y Movimiento
- **Regla P1–P73:** D-24, R-14 (Marcha y terreno intermedio)
- **Evidencia concreta:** `convex/territoryRules.ts`, `convex/territories.ts`
- **Problema y consecuencia jugable:** La marcha actual calcula el tiempo con multiplicadores de terreno neutro hasta definir reglas de terreno intermedio.
- **Solución propuesta:** Implementar el cálculo ponderado por trayecto exacto si se aprueba la regla R-14.
- **Dependencias:** Aprobación de diseño.
- **Criterio de aceptación:** Rutas de marcha reflejan penalizaciones de terreno intermedio de forma determinista.
- **Pruebas necesarias:** `territoryPureTests.ts`
- **Estado:** Pendiente.

### Tarea M-03 (P3 — Mejora futura)
- **Identificador:** TASK-M03
- **Prioridad:** P3
- **Sistema afectado:** Frontend / Interfaz del Mapa
- **Regla P1–P73:** P47, G (Mapa hexagonal)
- **Evidencia concreta:** `src/components/MapPanel.tsx`
- **Problema y consecuencia jugable:** Renderizado optimizable para mapas amplios de 331 celdas.
- **Solución propuesta:** Virtualización o paginación ligera del lienzo hexagonal.
- **Dependencias:** Ninguna.
- **Criterio de aceptación:** Fluidez superior a 60 FPS al desplazar el mapa.
- **Pruebas necesarias:** Pruebas visuales manuales.
- **Estado:** Pendiente.

---

## 4. Comprobaciones Específicas

- **Esquema de Convex y datos:** `convex/schema.ts` contiene todas las tablas con sus índices correctos y `schemaValidation: false` para resiliencia relacional.
- **Fuente autoritativa:** `resources`, `population`, `buildings`, `armyUnits` y `technologyProgress` son las fuentes únicas autoritarias gestionadas exclusivamente por mutaciones en servidor.
- **Seguridad y autenticación:** Verificación OIDC mediante `ctx.auth.getUserIdentity()` y validación estricta de titularidad (`isKingdomOwner`).
- **Protección de Iberia:** `DEMO_USER_ID` y el reino "Iberia" están protegidos contra mutaciones destructivas o desafíos bélicos en servidor.
- **Economía y fórmulas temporales:** Conversión exacta de 1 día real = 1 año de juego y liquidación continua idempotente.
- **Construcción y entrenamiento:** Colas autogestionadas con reembolsos del 50% y programación segura vía `ctx.scheduler.runAt`.
- **Parlamento y desafíos:** Máquina de estados disjunta (Bloque E) y congelación temporal de 15 minutos antes del combate.
- **Combate y hospital:** Simulador determinista con factor $k = 0.40$, murallas, contramedidas y recuperación hospitalaria.
- **Sincronización con GitHub y Convex:** Separación estricta entre código local, repositorio y backend remoto; prohibición de despliegues automáticos sin confirmación.

---

## 5. Orden de Ejecución (Secuencia de Bloques)

### Bloque 1: Consolidación y Verificación Local (Actual)
1. **Qué se va a modificar:** Ningún código fuente (fase de validación de estado).
2. **Qué archivos se pueden tocar:** Documentación en `docs/`.
3. **Qué no se debe modificar:** Código de backend y frontend.
4. **Pruebas y criterios:** Ejecución de `npm test` y `npm run test:integration` con 100% de éxito.
5. **Condiciones de terminación:** Informes de auditoría y mejora completados.
6. **Dependencias:** Ninguna.

### Bloque 2: Sincronización Remota Controlada (Posterior, bajo demanda)
1. **Qué se va a modificar:** Despliegue de esquema y funciones en Convex remoto (`dev/laconquista`).
2. **Qué archivos se pueden tocar:** Configuración de despliegue si es requerido.
3. **Qué no se debe modificar:** Datos preexistentes del reino Iberia o cuentas de usuario activas.
4. **Pruebas y criterios:** Comprobación de conectividad WebSocket y consultas reactivas estables.
5. **Condiciones de terminación:** Funcionamiento verificado en la URL de desarrollo compartido.
6. **Dependencias:** Bloque 1 completado y autorización explícita del usuario.

---

## 6. Plan de Protección del Proyecto

1. **Copia recuperable:** Conservar el estado base de los archivos comprimidos o en el directorio de trabajo local.
2. **Revisión de diferencias:** Inspeccionar cualquier diff antes de aceptar cambios externos o de agentes.
3. **Protección frente a GitHub:** No ejecutar comandos de sincronización remota sin confirmación expresa.
4. **Validación local:** Ejecutar siempre el linter (`npm run lint`), las pruebas puras (`npm test`) y de integración (`npm run test:integration`) tras cualquier cambio hipotético.
5. **Separación de entornos:** Nunca mezclar el despliegue de Convex con la publicación de código fuente.
6. **Protección de datos remotos:** No ejecutar migraciones destructivas ni borrar colecciones en Convex.
7. **Credenciales seguras:** Mantener `.env.local` fuera del repositorio y usar exclusivamente `.env.example`.

---

## 7. Resumen de Entrega

- **Número de tareas por prioridad y estado:** 0 Bloqueantes (P0), 0 Necesarias urgentes (P1), 2 Mejoras funcionales (P2, pendientes de diseño), 2 Mejoras futuras (P3), 3 Decisiones pendientes.
- **Bloqueantes reales encontrados:** Cero (0). El sistema está completo y funcional a nivel de motor.
- **Decisiones pendientes:** Nombres de civilización, terreno intermedio y apuestas.
- **Primer bloque recomendado:** Bloque 1 (Consolidación y verificación local con 160 pruebas exitosas).
- **Archivos consultados:** `Especificacion_Maestra_P1-P73.txt`, `Complemento_Datos_Pendientes.txt`, `INFORMACION_PENDIENTE.md`, `AUDITORIA_COHERENCIA_P1_P73.md`, y los módulos en `convex/` y `src/`.
- **Archivo creado:** `docs/INFORME_MEJORAS_PENDIENTES.md`.
- **Pruebas realmente ejecutadas durante esta tarea:** `npm test` (149 pruebas puras superadas) y `npm run test:integration` (11 pruebas de integración superadas con éxito).
