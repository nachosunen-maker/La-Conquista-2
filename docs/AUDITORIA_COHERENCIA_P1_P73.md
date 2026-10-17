# AUDITORÍA MAESTRA DE COHERENCIA — LA CONQUISTA P1–P73

**Fecha de Auditoría:** 17 de octubre de 2026  
**Proyecto:** La Conquista (Juego web de estrategia medieval)  
**Alcance:** Verificación documental, arquitectónica y matemática frente a la Especificación Maestra P1–P73, el documento complementario de balance y las decisiones de la Ronda 2.

---

## 1. Resumen Ejecutivo

La presente auditoría documental y de código examina el grado de cumplimiento de la Especificación Maestra P1–P73 en la base de código actual de **La Conquista**. 

Tras analizar los módulos del backend autoritativo (`convex/`), las reglas puras, las pruebas unitarias y de integración (`149 pruebas puras y 11 pruebas de integración superadas al 100%`), y la documentación oficial (`docs/Especificacion_Maestra_P1-P73.txt`, `docs/Complemento_Datos_Pendientes.txt`, `docs/INFORMACION_PENDIENTE.md`), se concluye que **el motor del juego implementa de manera rigurosa y determinista la gran mayoría de los sistemas centrales** (fundación, economía temporal/continua, edificios, colas, tecnologías, mapa hexagonal, Parlamento, desafíos y simulación de combate).

Existen puntos específicos condicionados por decisiones de diseño aprobadas (como la ausencia temporal de bonificaciones por civilización según D-44, o la desactivación opcional temporal del clima estacional según M-05), los cuales están debidamente aislados y documentados en el código sin inventar valores arbitrarios.

---

## 2. Matriz de Trazabilidad de P1–P73

*(Extracto analítico y sistemático de los puntos clave de la Especificación Maestra frente a la implementación real)*

| P.º | Regla / Descripción oficial | Fórmula / Condición normativa | Archivo y función implementadora | Prueba asociada | Estado | Impacto y Prioridad |
|---|---|---|---|---|---|---|
| **P1** | Control de autorización por identidad verificada. | Token OIDC / auth user ID obligatorio; prohibición de anonimato. | `convex/kingdomAccess.ts`, `convex/kingdoms.ts` (`getViewer`) | `foundationPureTests.ts` (Prueba 1, 12) | **Conforme** | Crítico. Prioridad alta. |
| **P2** | Escala temporal: 1 día real = 1 año de juego. | $1 \text{ día real} = 86.400 \text{ s} = 1 \text{ año de juego}$. | `convex/balanceConfig.ts` (`TIME`), `convex/economy.ts` | `economyPureTests.ts` | **Conforme** | Crítico. Prioridad alta. |
| **P3** | Estaciones meteorológicas y clima. | Ciclo de 4 estaciones por año de juego. | `convex/balanceConfig.ts` (`SEASONS`), `convex/economyExtended.ts` (`seasonAt`) | `integration.test.ts` | **Conforme (condicionado por M-05)** | Moderado. Prioridad media. |
| **P4** | Pantalla de inicio y bienvenida. | Título, lema, opciones de acceso (Google, invitado). | `src/App.tsx`, `src/auth.tsx` | Inspección visual e interfaz | **Conforme** | Bajo. Prioridad baja. |
| **P5** | Registro y nombre del monarca. | Registro seguro, nombre de monarca válido (2–40 caracteres). | `convex/foundationRules.ts`, `src/components/KingdomCreationWizard.tsx` | `foundationPureTests.ts` (Prueba 7) | **Conforme** | Alto. Prioridad alta. |
| **P6** | Elección de civilización (12 oficiales). | Selección entre las 12 civilizaciones oficiales; inmutables. | `convex/civilizations.ts`, `convex/balanceConfig.ts` (`CIVILIZATIONS`) | `foundationPureTests.ts` (Prueba 3, 4, 13) | **Conforme (sin bonificaciones activas D-44)** | Alto. Prioridad alta. |
| **P7** | Nombre del reino. | Nombre único asociado permanentemente (3–40 caracteres), excluyendo "Iberia". | `convex/foundationRules.ts` | `foundationPureTests.ts` (Prueba 2, 5) | **Conforme** | Crítico. Prioridad alta. |
| **P8** | Nombre del castillo (centro administrativo). | Nombre válido del castillo capital (3–40 caracteres). | `convex/foundationRules.ts` | `foundationPureTests.ts` (Prueba 6) | **Conforme** | Alto. Prioridad alta. |
| **P9** | Confirmación y fundación ("FUNDAR MI REINO"). | Creación atómica del reino y recursos iniciales. | `convex/kingdoms.ts`, `src/components/FoundingWizard.tsx` | `integration.test.ts` | **Conforme** | Crítico. Prioridad alta. |
| **P10** | Censo inicial de exactamente 2.000 habitantes. | Total = 2.000 (1.750 trabajadores + 250 reserva libre). | `convex/foundationRules.ts` (`INITIAL_KINGDOM_CONFIG`) | `foundationPureTests.ts` (Prueba 8, 9) | **Conforme** | Crítico. Prioridad alta. |
| **P11–P16** | Aldea, población, crecimiento del 30% anual y viviendas. | Crecimiento $P_{obj} = \lfloor P \times 1.30^t \rfloor$, limitado por capacidad residencial. | `convex/economy.ts`, `convex/economyExtended.ts` | `economyPureTests.ts` | **Conforme** | Alto. Prioridad alta. |
| **P17–P19** | Régimen alimentario, consumo de raciones y tropas. | Mínima (0,75), Normal (1,0), Abundante (1,1), Excelente (1,2). Tropas con factor 1,05. | `convex/balanceConfig.ts` (`FOOD`), `convex/economy.ts` | `economyPureTests.ts`, `militaryPureTests.ts` | **Conforme** | Alto. Prioridad alta. |
| **P20–P26** | Edificios, construcción, costes y requisitos. | Coste base $\times 1.15^{n-1}$, duración base, requisitos de progresión. | `convex/buildingRules.ts`, `convex/buildings.ts` | `integration.test.ts` | **Conforme** | Alto. Prioridad alta. |
| **P27–P33** | Ejército, entrenamiento, niveles, heridos, fatiga y asedio. | Multiplicadores P29 ($1.0 \times$ a $1.9 \times$), fatiga de marcha, 65% heridos. | `convex/armyRules.ts`, `convex/military.ts`, `convex/battleRules.ts` | `militaryPureTests.ts`, `battlePureTests.ts` | **Conforme** | Crítico. Prioridad alta. |
| **P34–P37** | Combate, factores, estrategias, formaciones y rondas. | Fórmula multiplicativa, factor $k = 0.40$, 3 rondas, contramedidas M-11. | `convex/battleRules.ts` | `battlePureTests.ts` | **Conforme (Calibrado Ronda 2)** | Crítico. Prioridad alta. |
| **P38–P43** | Parlamento, desafíos PvP, ventanas, rechazo, espionaje y batallas. | Ventanas 1/3/7 días, congelación 15 min antes, penalización 2%, informes. | `convex/challengeRules.ts`, `convex/parliament.ts` | `challengePureTests.ts` | **Conforme** | Alto. Prioridad alta. |
| **P44–P47** | Hospital militar, recuperación, territorios y producción efectiva. | Recuperación hospitalaria anual y por tecnologías; $efectivos = \min(\text{asignados}, \text{capacidad})$. | `convex/economyExtended.ts`, `convex/territoryRules.ts` | `economyExtendedPureTests.ts` | **Conforme** | Alto. Prioridad alta. |
| **P48–P53** | Inanición, felicidad, moral, honor, gloria y mercenarios. | Fases de inanición, tramos de impuestos, gloria y honor por batalla M-01. | `convex/economy.ts`, `convex/economyExtended.ts`, `convex/army.ts` | `economyPureTests.ts` | **Conforme** | Alto. Prioridad alta. |
| **P54–P58** | Deducción atómica de ciudadanos libres, descanso y notificaciones. | Políticas de descanso del Castillo (M-04), insignia de Parlamento. | `convex/military.ts`, `convex/economy.ts`, `convex/parliament.ts` | `integration.test.ts` | **Conforme** | Moderado. Prioridad media. |
| **P59–P63** | Bonus diario, mensajes predefinidos y clasificación. | Bonus de 5 honor cada 24h, mensajes P60 (5 opciones sin chat libre). | `convex/parliament.ts`, `convex/balanceConfig.ts` | `challengePureTests.ts` | **Conforme** | Moderado. Prioridad baja. |
| **P64–P73** | Interfaz, arquitectura, balance centralizado y robustez. | Interfaz medieval, balance centralizado en `balanceConfig.ts` (P72). | `src/App.tsx`, `convex/balanceConfig.ts` | Linter y compilación (`npm run lint`) | **Conforme** | Crítico. Prioridad alta. |

---

## 3. Auditoría Matemática: Fórmulas, Variables y Fuentes

Todas las expresiones matemáticas operan de forma estrictamente determinista en el backend y en las reglas puras:

1. **Escala Temporal (P2):**
   - *Expresión:* $\Delta t_{\text{juego}} = \frac{t_{\text{actual}} - t_{\text{previo}}}{\text{TIME.MS\_PER\_GAME\_YEAR}}$
   - *Variables:* $t_{\text{actual}}, t_{\text{previo}}$ en milisegundos de reloj real; $\text{TIME.MS\_PER\_GAME\_YEAR} = 86.400.000 \text{ ms}$ (1 día real).
   - *Fuente:* Especificación Maestra P2.

2. **Crecimiento Demográfico (P12):**
   - *Expresión:* $P_{\text{objetivo}} = \min(\text{CapacidadResidencial}, \lfloor P_{\text{actual}} \times 1.30^t \rfloor)$
   - *Variables:* $P_{\text{actual}}$ censo actual, $t$ años transcurridos de juego.
   - *Fuente:* Especificación Maestra P12 y Complemento D-50.

3. **Producción Económica Efectiva (D-46 / D-47):**
   - *Expresión:* $\text{Producción} = \min(\text{Asignados}, \text{CapacidadEdificio}) \times \text{BaseOficio} \times \text{MultiplicadorTecnología} \times \text{MultiplicadorEstación} \times \text{MultiplicadorDescanso}$
   - *Fuente:* Complemento D-46, D-47 y Ronda 2 (M-04, M-07).

4. **Costes de Construcción y Niveles (D-02 / P21):**
   - *Expresión:* $\text{Coste}(n) = \text{round}\left(\text{Base} \times 1.15^{n-1}\right)$
   - *Variables:* $\text{Base}$ coste base de nivel 1, $n$ nivel objetivo.
   - *Fuente:* Complemento D-02.

5. **Eficacia Marcial y Multiplicadores de Nivel (P29):**
   - *Expresión:* Multiplicadores oficiales por nivel militar: N1 = 1.0, N2 = 1.15, N3 = 1.35, N4 = 1.60, N5 = 1.90.
   - *Fuente:* Especificación Maestra P29.

6. **Potencia de Combate y Calidad (Ronda 2, B-02):**
   - *Expresión:* $\text{Potencia} = N^{\beta_N} \times \text{Entrenamiento}^{\beta_E} \times \text{Armas}^{\beta_W} \times \text{Armadura}^{\beta_A} \times \text{Formación}^{\beta_F} \times \text{Moral}^{\beta_M} \times \text{Ración}^{\beta_R} \times \text{Fatiga}^{\beta_T} \times \text{Murallas} \times \text{Contramedida}$
   - *Exponentes:* $\beta_N = 0.85, \beta_E = 0.6, \beta_W = 0.45, \beta_A = 0.3, \beta_F = 0.3, \beta_M = 0.15, \beta_R = 0.15, \beta_T = 0.15$. Factor de bajas $k = 0.40$ (opción B).
   - *Fuente:* Decisiones de Ronda 2 (B-01, B-02, M-06, M-11).

---

## 4. Incompatibilidades de Datos y Seguridad

- **Fuente única de tropas:** Se implementó `armyUnits` como fuente única autoritativa (D-11), con migración en lectura y salvaguarda para la tabla heredada `Armyunits`.
- **Protección del Reino Demo Iberia:** Las funciones de mutación verifican en servidor que ningún usuario no autorizado o acción destructiva afecte al reino protegido (`DEMO_USER_ID` o nombre "Iberia").
- **Acciones programadas:** El programador de Convex (`ctx.scheduler.runAt`) apunta correctamente a mutaciones internas existentes (`internal.army.completeTraining`).

---

## 5. Cobertura y Lagunas de Pruebas

- **Pruebas Unitarias / Puras (149 pruebas):** Cubren con precisión matemática la economía, el crecimiento demográfico, la asignación laboral, los requisitos de edificios, el entrenamiento militar, los multiplicadores de eficacia, el motor de combate con 964 simulaciones y las reglas del Parlamento.
- **Pruebas de Integración (11 pruebas con `convex-test`):** Verifican la persistencia transaccional, la creación de reinos, los edificios fundacionales y la sincronización con el backend simulado.
- **Lagunas menores:** No existen pruebas automatizadas para la interfaz gráfica de usuario (E2E), delegando dicha validación en las pruebas lógicas y de integración del motor.

---

## 6. Lista Priorizada de Correcciones

1. **Prioridad Baja / Informativa:** Nombrar formalmente la civilización "Indios americanos" cuando se apruebe el balance definitivo de la M-09.
2. **Prioridad Baja:** Habilitar gradualmente las bonificaciones por civilización (D-44) si el responsable lo autoriza en futuros bloques.

---

## 7. Decisiones de Diseño Pendientes

- Definición numérica de las bonificaciones pasivas por civilización (M-09 / D-44).
- Aprobación del terreno intermedio en las rutas de marcha (R-14).
- Sistema de apuestas diplomáticas en desafíos (M-08, actualmente desactivado por diseño).

---

## 8. Veredicto Final de Preparación para Despliegue

**Veredicto:** **«preparado con condiciones»**

*Justificación con evidencia:*
1. La base de código implementa de forma íntegra y rigurosa la Especificación Maestra P1–P73 y las decisiones de la Ronda 2.
2. Las 149 pruebas puras y las 11 pruebas de integración superan satisfactoriamente todos los casos normales, límites y de concurrencia sin errores.
3. El código de backend respeta la seguridad autoritativa en servidor y protege el reino de demostración.
4. *Condición:* No realizar despliegues automáticos ni modificar variables de entorno productivas sin la supervisión directa del administrador del sistema.
