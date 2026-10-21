# CLAUDE.md — LA CONQUISTA

Juego web multijugador de estrategia y gestión medieval, de partidas persistentes.
**Versión de este documento: 21-10-2026.** Sustituye a cualquier CLAUDE.md anterior (el anterior hablaba de Appwrite, que se ha descartado).

Fuentes, de más antigua a más reciente:
1. `LaConquista_Especificacion_Maestra_Puntos_1_al_73.docx` — especificación original (P1–P73). Tenía 1.000 habitantes en P10, temporadas competitivas, P56/P61 vacíos y P66 truncado.
2. `docs/Complemento_Datos_Pendientes.txt` (17-10-2026) — valores de balance propuestos y **aprobados para carga el 17-10-2026**.
3. `docs/Decisiones_Pendientes_de_Aprobacion.pdf` (17-10-2026) — «Ronda 2»: decisiones B-, R-, M-, T-.
4. `docs/AUDITORIA_COHERENCIA_P1_P73.md` y `docs/INFORME_MEJORAS_PENDIENTES.md` (17-10-2026).
5. Exploración del mapa (18-10-2026) — registrada en `.aistudio/.../implementation_plan.md`.
6. `LaConquista_Especificacion_Maestra_Actualizada_P1-P73_Convex.docx` (20-10-2026) — **especificación vigente**: 2.000 habitantes, estaciones en vez de temporadas, P66 restaurado, P56/P61 marcados «pendiente de aclaración».
7. `La_Conquista_12_Civilizaciones_Historicas.pdf` (20-10-2026) — dossier histórico de las 12 civilizaciones: **propuestas de diseño, no aprobadas ni implementadas** (sección 6).
8. Decisiones del responsable en conversación (20-10-2026 y 21-10-2026) — sección 21. **Manda siempre la decisión más reciente.**

Las referencias `(P17)`, `(D-02)`, `(M-05)`… apuntan a esos documentos.
Idioma de documentación, textos de interfaz y nombres visibles: **español**.

---

## 0. Cómo trabajar en este proyecto

1. **No reabrir lo ya decidido.** Antes de preguntar nada, mirar la sección 21. Si algo está cerrado, no se vuelve a preguntar ni a proponer otra cosa. Si el código difiere de una decisión cerrada, se avisa en una línea y se propone el arreglo; no se reabre el debate.
2. **Despacio y punto por punto.** Un bloque cada vez; no pasar al siguiente sin cerrar el anterior. Cambios pequeños y revisables.
3. **Orden obligatorio (P71).** No añadir contenido sobre sistemas fundamentales rotos: 1 economía → 2 tiempo → 3 construcción → 4 guardado → 5 ejército → 6 batallas → 7 progresión → 8 servidor fiable.
4. **No inventar reglas.** Todo valor vive en `convex/balanceConfig.ts` con su origen etiquetado: `[MAESTRA Pnn]`, `[COMPLEMENTO]`, `[DECISIÓN fecha]` o `[DERIVADO]`. Ningún número suelto en la lógica (P72). Si falta un dato, se pregunta una vez, con una propuesta concreta.
5. **Distinguir siempre** entre: documentación · código local · pruebas locales · backend desplegado. No afirmar que algo funciona o está sincronizado sin haberlo verificado.
6. **Seguridad de entornos.** Prohibido sin autorización expresa del responsable: desplegar (`npx convex dev/deploy`), ejecutar mutaciones remotas, migraciones o borrados en Convex, tocar el reino de pruebas **Iberia**, o subir secretos al repositorio (`.env.local` fuera del repo; solo `.env.example`).
7. **Verificación tras cada cambio de código:** `npm run lint` · `npm test` · `npm run test:integration`. Si se toca el combate: `npm run simulate:battles`.
8. **Cada acción de la interfaz indica** (P70): qué hace → cuánto cuesta → cuánto tarda → qué resultado tendrá.
9. **Personas y herramientas.** El responsable es **principiante y trabaja solo desde móvil/tablet**: no ejecuta comandos; explicar con lenguaje sencillo y pasos cortos. Un colaborador con Claude premium resuelve los cálculos difíciles y ejecuta comandos; el código se comparte en GitHub. Mantener los cambios pequeños para que sean fáciles de revisar desde el móvil.
10. **Respuestas útiles y breves.** Empezar por la respuesta; sin rodeos ni repetir lo ya acordado.

---

## 1. Concepto y principios (P1, P67, P73)

- El jugador es el **monarca**. No controla ciudadanos ni soldados individuales: toma decisiones estratégicas y administrativas.
- Principio central: **«El jugador mueve los hilos y la población ejecuta automáticamente las órdenes.»**
- **Juego web y multijugador** (confirmado): todos comparten un mundo persistente.
- No obliga a estar conectado. Ni demasiado pasivo ni convertido en trabajo: entrar unos minutos, decidir, salir y volver a ver cómo evolucionó el reino.
- Objetivo final: sentirse como **dirigir un reino vivo**. Al volver hay recursos nuevos, obras terminadas, heridos recuperándose, investigaciones completas, posibles desafíos y cuenta atrás para una batalla.
- Una derrota nunca elimina la partida (P46, P68).

---

## 2. Tiempo (P2, P66)

- **1 día real = 1 año de juego = 86.400 s.** La misma proporción para calendario, recursos, población, construcción, investigación, entrenamiento y recuperación.
- **Prohibido** cualquier botón o sistema que avance el tiempo («Pasar 1 año», «Simular día»…).
- El servidor calcula el tiempo con el reloj real y guarda la última actualización; la liquidación es **continua e idempotente** (reconectar dos veces no duplica nada).
- **El cliente nunca decide cuánto tiempo ha pasado** (P66). Tampoco recursos, tropas, territorios ni resultados de combate sin validación del servidor.
- Estaciones (primavera, verano, otoño, invierno): **solo informativas** (M-05 B). Modificadores configurados pero desactivados. Sin temporadas competitivas ni reinicios.

---

## 3. Tecnología y arquitectura

**Stack actual (confirmado):**
- Cliente: **React 19 + Vite + TypeScript + Tailwind 4** (proyecto nacido en Google AI Studio; queda la carpeta `.aistudio/`).
- Backend: **Convex** (base de datos, funciones de servidor, programador de tareas `ctx.scheduler.runAt`). Despliegue de desarrollo en región `eu-west-1`.
- Pruebas: pruebas puras con `tsx` + `convex-test`/`vitest` para integración.
- **Appwrite: descartado.** El proyecto «La Conquista» creado en Appwrite Cloud (región Fráncfurt) no se usa; se puede ignorar o borrar. No hay que seguir esa guía.

**Comandos** (`package.json`): `npm run dev` · `build` · `lint` (tsc de `src/` y `convex/`) · `test` (pruebas puras) · `test:integration` · `simulate:battles` · `codegen:offline`.

**Mapa del código:**
| Ruta | Contenido |
|---|---|
| `convex/balanceConfig.ts` | **Todos los parámetros de balance** (P72) |
| `convex/*Rules.ts` | Reglas puras y deterministas (sin efectos secundarios) |
| `convex/*PureTests.ts`, `integration.test.ts` | Pruebas |
| `convex/economy.ts`, `economyExtended.ts`, `economyAdapter.ts` | Economía continua, felicidad, inanición |
| `convex/buildings.ts` (ruta canónica), `army.ts`, `military.ts`, `technologies.ts`, `territories.ts`, `parliament.ts`, `civilizations.ts`, `kingdoms.ts` | Mutaciones y consultas |
| `convex/schema.ts` | Tablas (`schemaValidation: false`) |
| `src/App.tsx` y `src/components/*` | Interfaz (Aldea, Ejército, Universidad, Parlamento, Mapa, asistentes de fundación) |
| `src/auth.tsx`, `convex/auth.config.ts` | Autenticación (hoy solo Google; ver sección 5) |
| `scripts/` | Pruebas económicas, simulador de batallas, generación offline de la API |
| `docs/` | Especificación, complemento, decisiones, auditorías |

**Deuda técnica conocida:**
- La carpeta `convex_backup/` es una copia de `convex/`: **no editarla**; candidata a borrarse con autorización.
- `.gitignore` solo ignora `.env.local`; el `.env` actual contiene únicamente datos públicos (URL de Convex y Client ID de Google). Añadir `.env` al `.gitignore` antes de guardar cualquier secreto.
- Fuente única de tropas: `armyUnits`. La tabla heredada `Armyunits` y el campo `regularSoldiers` se mantienen solo por migración; **nunca sumar ambos**.
- Protección de Iberia (`DEMO_USER_ID` / nombre «Iberia»): las mutaciones destructivas la rechazan en servidor.

---

## 4. Estado del proyecto a 20-10-2026

*Basado en los documentos y en la lectura del código. Las cifras de pruebas son las de los informes; no se han ejecutado en esta revisión.*

| Área | Estado |
|---|---|
| Fundación del reino (P4–P10), censo inicial 2.000 | ✅ Implementado |
| Economía temporal continua, población, alimentación, felicidad, inanición, impuestos | ✅ Implementado |
| Edificios (18) y cola de construcción | ✅ Implementado |
| Ejército, entrenamiento, heridos, hospital, mercenarios (un solo tipo) | ✅ Implementado / 🟡 mercenarios por ampliar |
| Tecnologías (13 generales + 12 de civilización) | ✅ Implementado |
| Mapa hexagonal (331 celdas), territorios, reclamación | ✅ Implementado |
| Exploración con niebla de guerra | ✅ Implementado (18-10) |
| Parlamento y desafíos (máquina de estados) | ✅ Implementado |
| Combate automático (simulador determinista, 3 rondas) | ✅ Implementado y recalibrado (Ronda 2) |
| Civilizaciones | 🟡 Parcial: bonificación pasiva + tecnología única por civilización. **Falta** equipo, tropas y edificios únicos |
| Login | 🟡 Nombre de gobernante + contraseña decidido; comprobar implementación y pruebas. Sin Google/Gmail (sección 5) |
| Misiones progresivas, diarias y secretas | ⛔ No implementadas; diseño funcional acordado el 21-10-2026 |
| Despliegue real y pruebas contra el servidor de Convex (T-02) | ⛔ Pendiente (necesita autorización) |
| Bots PvE · apuestas en desafíos · efectos del clima | ⛔ Descartados o desactivados por decisión |

Informes: 164 pruebas puras y 14 de integración superadas (18-10), 964 simulaciones de combate. **Nunca se ha jugado contra el servidor real.**

---

## 5. Pantalla de inicio, inicio de sesión y creación del reino (P4–P9)

**Decisiones del responsable (20-10-2026 y actualización 21-10-2026):**
- Cada jugador entra con **nombre de gobernante + contraseña** y **retoma su partida desde cualquier dispositivo o lugar**. La cuenta y todo el progreso viven en el servidor; el navegador solo guarda la sesión. **Sin verificación por Gmail/Google**: el inicio con Google actual debe retirarse.
- Las opciones de entrada (**crear cuenta, iniciar sesión, entrar como invitado**) salen **en la misma pantalla de inicio de la maqueta**, no en pantallas aparte.
- **Invitado permitido**, para ver cómo es una civilización o el juego, con **aviso obligatorio** de que el progreso no se guarda.

**Diseño de referencia:** maqueta `a_cinematic_high_fantasy_medieval_game_login_intr.png`. A la izquierda, ilustración con el logo **LA CONQUISTA**, «Un reino. Una corona. Tu legado.» y «Forja tu reino. Escribe tu historia.». A la derecha, un panel con marco dorado: «Comienza tu reinado — Crea tus credenciales para conservar tu progreso.» y una línea de 3 pasos: **1 Tu identidad de gobernante** · **2 Elige tu civilización** («cada civilización tiene sus propias ventajas y desafíos») · **3 Bautiza tu reino y tu capital**. *(Los textos de la maqueta, más recientes, sustituyen al lema de P4; en el juego el centro administrativo sigue siendo el Castillo, P8.)*

**Estados del panel derecho (misma pantalla):**
1. **Crear cuenta** (estado inicial, el de la maqueta). Paso 1 activo con los campos *Nombre de gobernante* («Ej. Alfonso de Castilla») y *Contraseña* («Mínimo 8 caracteres», con ojo para mostrar/ocultar); botón dorado **Crear mi cuenta**; debajo «¿Ya tienes una cuenta? **Iniciar sesión**»; después el botón **Entrar como invitado** con la nota «Invitado: el progreso podría perderse y no se garantiza su recuperación.». Los pasos 2 y 3 aparecen atenuados hasta completar el anterior.
2. **Iniciar sesión** (al pulsar el enlace; mismo marco, mismos colores). Campos *Nombre de gobernante* y *Contraseña*; botón **Entrar**; enlace «¿Aún no tienes cuenta? **Crear cuenta**»; el botón **Entrar como invitado** sigue visible. Tras entrar: si el jugador ya tiene reino, va a la **Aldea** con su partida; si creó la cuenta pero no fundó el reino, retoma el asistente en el **paso 2**.
3. **Invitado** (ver más abajo).
4. **Asistente de creación** (pasos 2 y 3 y confirmación): ver al final de esta sección.

**Reglas de la cuenta:**
- El **nombre de gobernante es único** (sin distinguir mayúsculas) porque es el nombre con el que se inicia sesión. Longitud 2–40; los caracteres permitidos se definen en el bloque.
- Contraseña de mínimo 8 caracteres, gestionada por el sistema de autenticación y **nunca almacenada ni mostrada en texto plano** (P5).
- Errores genéricos («Nombre o contraseña incorrectos»), sin revelar cuál falla; límite de intentos fallidos *(propuesta)*.
- Sesión persistente en el dispositivo y opción de **Cerrar sesión**. Varias sesiones a la vez en distintos dispositivos: el servidor es la autoridad y valida cada acción (sin duplicados).
- Sin correo no hay recuperación de contraseña: **ver punto abierto 1 de la sección 21**.

**Modo invitado** *(alcance propuesto por el asistente, ajustable)*:
- Al pulsar **Entrar como invitado** aparece un aviso: «Como invitado puedes ver cómo es una civilización y el juego, pero **no se guardará tu progreso**. Si cierras o recargas, lo perderás. Crea una cuenta para conservarlo.» Botones: **Continuar como invitado** · **Crear cuenta**.
- Durante la sesión, un banner fijo: «Modo invitado · no se guarda tu progreso — Crear cuenta».
- El invitado puede **ver las fichas de civilización** (bonificaciones, equipo, edificio único, tropa) y **explorar la interfaz** con un reino de demostración en solo lectura (hoy Iberia, que ya se puede consultar sin autenticar).
- El invitado **no existe en el mundo compartido**: no aparece en el mapa, no puede desafiar ni ser desafiado, no reclama territorios y no afecta a otros jugadores. No se crean reinos ni filas reales para él (esto respeta la autoridad del servidor, P66). *La prohibición de anonimato de la auditoría (P1) queda limitada a jugar de verdad: para jugar hace falta cuenta.*
- Si en el futuro se quiere que el invitado **pruebe acciones**, usar una copia temporal que se borra al cerrar; decidir en el bloque de login.

**Asistente de creación del reino** (tras crear la cuenta):
1. Civilización (12; inmutable al fundar).
2. Nombre del reino (3–40 caracteres; único; asociado permanentemente; «Iberia» reservado).
3. Nombre del castillo (3–40 caracteres).
4. Confirmación «Tu reino está preparado» (monarca, reino, castillo, civilización) → **FUNDAR MI REINO** (creación atómica).

**Notas técnicas para quien implemente:**
- Proveedor recomendado (Ronda 2, T-01 B): **Convex Auth con proveedor de contraseña**. Por defecto identifica la cuenta con un correo: para iniciar con *nombre de gobernante* hay que usar un identificador propio o un identificador interno sintético (no se envía ningún correo). **Comprobar la documentación vigente de Convex Auth antes de implementar.** Los secretos de firma van en las variables de entorno de Convex, nunca en el repositorio.
- Retirar el inicio con Google: `convex/auth.config.ts`, `src/auth.tsx`, `.env.example` (Client ID).
- El invitado **no tiene identidad en Convex**: solo usa consultas públicas de lectura.

---

## 6. Civilizaciones (P6, D-43 a D-45, M-09)

Ingleses · Romanos · Griegos · Vikingos · Bizantinos · Árabes · Mongoles · Chinos · Japoneses · Navajos · Aztecas · Masáis.

**Reglas fijas:** cada una con bonificaciones y estilo propios; **ninguna objetivamente superior**; se elige al fundar y es inmutable; cada civilización debe tener **armas, armaduras, edificios y soldados personalizados** a su estilo, lo máximo posible. Los multiplicadores de calidad de armas/armaduras (P30–P31) y de nivel militar (P29) son **iguales para todas**: cambia el nombre, la estética y las bonificaciones.

**Ya en el código** (`balanceConfig.ts → CIVILIZATIONS`, `CIVILIZATION_BONUSES_ENABLED = true`): una pasiva doble y una tecnología única por civilización.

| Civilización | Pasiva actual |
|---|---|
| Ingleses | +10 % madera · −10 % duración de instrucción de arqueros |
| Romanos | +10 % piedra · −10 % duración de construcción |
| Griegos | −10 % duración de investigación · +5 felicidad base |
| Vikingos | −15 % duración de exploración · +10 % almacenamiento |
| Bizantinos | +10 % oro · +5 % defensa militar |
| Árabes | +8 pp recuperación de heridos · +5 % oro por comercio |
| Mongoles | +15 % velocidad de marcha · −10 % duración de instrucción de caballería |
| Chinos | +8 % alimentos · +5 % capacidad de viviendas |
| Japoneses | +10 % hierro · +5 % poder ofensivo |
| Navajos | Pasiva anterior pendiente de rediseño; no aplicar valores nuevos sin balance |
| Aztecas | +12 % alimentos · +4 felicidad base |
| Masáis | Pasiva anterior pendiente de rediseño; no aplicar valores nuevos sin balance |

**Pendiente de implementar (decisión del responsable, 20-10-2026):** las singularidades de **armas, armaduras, soldados y edificios** de cada civilización.

**Base de diseño para ese bloque** *(propuesta anterior del asistente; no aprobada, ajustable)*. Equipo emblemático (arma · armadura), edificio único (variante con nombre y estética propios de un edificio base) y tropa característica:

| Civilización | Equipo | Edificio único | Tropa |
|---|---|---|---|
| Ingleses | Arco largo · cota de malla | Campo de Tiro (Cuartel) | Arquero de arco largo |
| Romanos | Gladius y pilum · lorica segmentata | Castra (Cuartel) | Legionario |
| Griegos | Dory y xiphos · coraza de bronce y hoplon | Liceo (Universidad) | Hoplita |
| Vikingos | Hacha, lanza y escudo redondo · cota con casco (sin cuernos) | Salón Largo (Taberna) | Huscarl |
| Bizantinos | Espatión y kontos · lorikion | Hipódromo (Circo) | Catafracto |
| Árabes | Lanza, espada y arco compuesto · malla y coraza lamelar | Caravasar (Mercado) | Jinete ligero (arquero a caballo) |
| Mongoles | Arco compuesto · cuero lacado | Ger del Kan (Viviendas) | Jinete arquero |
| Chinos | Jian y ballesta · armadura laminada | Arrozal Imperial (Granja) | Ballestero |
| Japoneses | Katana, yari y yumi · dō-maru / gusoku | Herrería del Maestro Forjador (Herrería) | Samurái (y ashigaru lancero) |
| Navajos | Equipo, edificio y tropa característicos por diseñar según el dossier histórico | Pendiente | Pendiente |
| Aztecas | Macuahuitl · ichcahuipilli | Templo Mayor (Iglesia) | Guerrero Águila |
| Masáis | Lanza y escudo; detalles por validar históricamente | Pendiente | Pendiente |

La tabla completa de nombres por nivel de calidad (palo → acero avanzado; ninguna → acero) de cada civilización se define en ese bloque. Las bonificaciones deben revisarse en el balance (M-09 recomendaba ±5 % simétricos).

**Reglas de diseño tomadas del dossier histórico (20-10-2026; propuestas, no aprobadas):**
- **Una cronología y una región por facción** antes de implementar su equipo. Propuesta inicial: Ingleses siglos XI–XV · Romanos Imperio alto (siglos I–II) · Griegos época clásica (hoplitas) · Vikingos VIII–XI · Bizantinos periodo medio (kataphraktoi) · Árabes califatos (VII–XIII) · Mongoles XIII–XIV · Chinos dinastía Song · Japoneses periodo Sengoku · Aztecas/mexicas XIV–XVI prehispánico · Navajos y Masáis: cronología, región y equipamiento por documentar antes de implementar.
- **No mezclar épocas ni materiales:** los aztecas no tienen caballos ni acero europeo; la pólvora china y el arcabuz japonés (teppō) solo se desbloquean por tecnología y época; los vikingos no llevan cascos con cuernos; la katana no es el arma universal (lanzas y arcos cuentan igual); el equipo romano no mezcla periodos.
- **Un arma característica no es más poderosa:** los multiplicadores siguen siendo los generales (P30–P31). Solo cambian nombre, estética y bonificación.
- **Cada pasiva lleva ventaja y debilidad** (ninguna civilización superior). Ejemplos del dossier: Ingleses con caballería pesada más cara · Romanos con caballería menos especializada · Vikingos peores en asedios largos · Mongoles débiles en defensa urbana fija · Bizantinos con élites caras · Aztecas sin caballería. **La configuración anterior solo tenía ventajas**: el diseño nuevo deberá incluir una debilidad por civilización. Los valores numéricos antiguos de Navajos/Masáis deben revisarse antes de aplicarlos.
- Para mantener un tipo de tropa si la civilización no tiene caballería (p. ej. aztecas), sustituirlo por una unidad de élite equivalente del mismo tipo; a decidir en el bloque.

---

## 7. Población y profesiones (P12–P16, P54, D-46, D-47, D-50)

- Censo inicial: **2.000 habitantes** (1.750 trabajadores + 250 de reserva libre). Distribución y recursos iniciales: **provisionales**.
- Crecimiento: **+30 % por año de juego, orgánico y continuo**, limitado por la capacidad residencial: `P_objetivo = min(capacidadResidencial, ⌊P × 1,30^t⌋)`. Sin viviendas no sube.
- Campos separados: población civil, militar y total. **Los soldados se restan de la población civil libre** (el reclutamiento no retira trabajadores productivos). Los mercenarios cuentan como efectivos militares y **no** generan natalidad ni capacidad residencial.
- El jugador **NO controla personas individuales**: asigna cantidades a profesiones. Un trabajador no puede estar en dos profesiones.
- Producción efectiva: `min(asignados, capacidad de edificios completados) × tasa del oficio × multiplicadores`.
- Tasas por trabajador y día real: alimentos 2 · madera 1 · piedra 0,75 · hierro 0,40 · oro 0,20.
- Profesiones con efecto (M-07): medicina, religión, circo, panadería, construcción, además de los cinco oficios de recursos. Herrería y Mercado sin efecto hasta definir fabricación y comercio.
- **Descanso (M-04):** política del Castillo: normal · intensiva («A tope»: +15 % producción, −3 felicidad/día, +5 fatiga/día) · relajada (−10 % producción, +2 felicidad/día, −5 fatiga/día).
- **Hacinamiento y viviendas (P16):** peor descanso, felicidad y productividad.
- **Supervisores (P25, M-03):** ranuras de investigación por nivel de Universidad (sección 9).

---

## 8. Edificios y construcción (P20–P23, P63, D-01 a D-07)

**Edificios (18 incluido el Castillo):** Castillo · Viviendas · Granja · Aserradero · Cantera · Mina de hierro · Mina de oro · Cuartel/Barracones · Herrería/Forja · Universidad · Murallas · Mercado · Parlamento · Hospital militar · Taberna · Panadería · Iglesia · Circo/Feria.
*(Barracones = Cuartel. Metalurgia = Forja = Herrería: **mismo edificio**, ID técnico `herreria`. Hospital militar = Enfermería militar.)*

**Reglas de construcción (vigentes):**
- **2 obras simultáneas** (ranuras). Nunca instantáneas: progreso y tiempo restante visibles.
- Coste: `coste(n) = redondear(base × 1,15^(n−1))`. **+15 % por nivel.**
- Duración: `base × (1 + 0,01 × (n−1))`. **+1 % por nivel** (P22).
- Cancelar: reembolso del **50 %** de lo pagado. Los recursos se descuentan una sola vez al iniciar.
- Capacidad lineal por nivel: `capacidadBase × nivel`. Edificios en construcción no aportan capacidad.
- **Ningún edificio supera el nivel del Castillo** (D-05). Nivel máximo técnico: 100.
- Los edificios en construcción no cuentan; sin mejoras infinitas sin progresión.

**Requisitos:** Viviendas, Granja, Aserradero, Cantera, Cuartel, Taberna, Panadería, Iglesia, Circo ← Castillo 1 · Mina de hierro ← Cantera 1 · Mina de oro, Universidad, Murallas, Mercado, Parlamento, Hospital militar ← Castillo 2 · Herrería ← Cuartel 1 + Mina de hierro 1.

**Capacidades por nivel:** Viviendas 100 residentes · Granja 100 trabajadores · Aserradero 80 · Cantera 80 · Mina de hierro 60 · Mina de oro 50.

**Edificios fundacionales (R-01):** Castillo 1, Viviendas 20, Granja 11, Aserradero 4, Cantera 4, Mina de hierro 2, Mina de oro 1 (para que los 2.000 iniciales no pasen hambre, P19).

**Almacén (M-06):** 10.000 unidades por recurso + 2.000 por nivel de Mercado. Murallas: +5 % de defensa por nivel (máx. +50 %).

Los costes y duraciones base de cada edificio están en `balanceConfig.ts` (`BUILDINGS`).

---

## 9. Universidad y tecnologías (P24, P25, P62, D-16 a D-21, M-03)

- Hay **árbol tecnológico** desarrollado: 13 tecnologías generales + 12 de civilización (una por civilización, requieren Universidad 2). Ramas: económica, civil, militar, inteligencia, civilización.
- **Investigación por ranuras según el nivel de la Universidad: 1 ranura (nivel 1), 2 (nivel 3), 3 (nivel 5).** (M-03 B; sustituye a la regla antigua «una a la vez».)
- El coste se descuenta al iniciar; cancelar devuelve el 50 %. Progreso por reino en `technologyProgress`; efectos idempotentes.
- Ejemplos de requisitos: Cataplasmas medicinales y Espionaje I ← Castillo 2 + Universidad 2 · Acero avanzado ← Castillo 5 + Universidad 3 + Herrería 4.
- Efectos relevantes: acero (1,15) y acero avanzado (1,30) desbloquean equipo; Espionaje I/II estrechan la estimación del enemigo; medicina sube la recuperación de heridos (tope 60 %/año).

---

## 10. Economía, impuestos y bienestar (P26, P27, D-48, D-49, R-02 a R-05)

- Recursos: **oro, madera, piedra, hierro, alimentos.**
- **Impuestos 0–100 %.** Base imponible = unidades producidas de alimentos, madera, piedra y hierro (R-02 A). 0–10 %: sin penalización; por encima, baja la felicidad (−0,1 por punto sobre 10); 31–60 % penaliza productividad hasta −15 %; 61–100 % penaliza moral y riesgo de disturbios. El 100 % no debe ser dominante.
- **Felicidad y moral:** escala 0–100, valor inicial 70, cambio máximo ±5 por día. Contribuciones (R-03/05): ración mínima −2, normal 0, abundante +1, excelente +2; hacinamiento −2; iglesia +1; circo +1; inanición −2.
- **Inanición (D-48):** déficit < 1 día real: alerta y −2 felicidad/día · 1–3 días: productividad civil −10 %, moral militar −10 · > 3 días: −0,5 % de población civil/día y deserción del 1 %/día. Se persiste en servidor.
- **Sin salario militar** (D-51 B): el mantenimiento del ejército se paga en alimentos y en el coste inicial.

---

## 11. Alimentación (P17–P19)

Raciones: mínima 0,75 · normal 1,00 · abundante 1,10 · excelente 1,20 (+ bonificación de moral según nivel).
Los soldados consumen un **5 % más** (factor 1,05); las máquinas de asedio no comen (los operadores sí). Consumo civil base: 1 ración por habitante y día real. Los 2.000 iniciales no deben entrar en hambruna.

---

## 12. Ejército (P28–P33, P44, P53, D-08 a D-15, M-02, M-11)

- Regimientos abstractos; nunca soldados individuales en tiempo real. Tipos: **infantería, arquería, caballería, asedio** (IDs `infanteria`, `arqueria`, `caballeria`, `asedio`).
- **Entrenamiento asíncrono** con cola por Cuartel (una cola en nivel 1; +1 por cada 3 niveles, máximo 4). Cancelar devuelve el 50 % y la población reservada.
- **Niveles militares (multiplicador de eficacia):** 1 Milicia 1,00 · 2 Entrenado 1,15 · 3 Veterano 1,35 · 4 Profesional 1,60 · 5 Élite 1,90. Requisitos: N2 Castillo 2 + Cuartel 2 · N3 Castillo 4 + Cuartel 3 + Universidad 2 · N4 Castillo 6 + Cuartel 4 + Universidad 3 · N5 Castillo 8 + Cuartel 5 + Universidad 4 + Herrería 5.
- **Armas:** palo 0,70 · lanza básica 0,90 · espada de hierro 1,00 · acero 1,15 · acero avanzado 1,30. **Armaduras:** ninguna 0,70 · piel 0,85 · cuero reforzado 0,95 · hierro 1,10 · acero 1,25. El desbloqueo depende de Herrería, Mina de hierro y tecnologías (R-09 A). El equipo se elige para todo el ejército y de momento no tiene coste de fabricación.
- **Fatiga:** 0–10 % sin penalización · 11–25 % −3 % · 26–40 % −8 % · 41–60 % −15 % · 61–75 % −25 % · 76–90 % −40 % · >90 % −55 %.
- **Moral** depende de alimentación, descanso, impuestos, victorias, derrotas, felicidad, liderazgo, religión y situación general.
- **Mercenarios (hoy):** Taberna; 25 oro por unidad (infantería nivel 2); hasta 50 por nivel de Taberna; contrato de 7 días reales; desaparecen al expirar; sin natalidad. El jugador pidió **varios tipos «unos más baratos y otros más caros»**: ampliar (ver sección 21).
- **Modo «A TOPE» (P55):** política intensiva del Castillo + prioridad militar; con consecuencias económicas y sociales.

---

## 13. Combate (P34–P37, P43, P47, P52, P69, B-01, B-02, M-11)

- Batallas **automáticas**. El jugador configura antes: formación, estrategia, tropas, alimentación, entrenamiento y equipamiento. La composición enemiga permanece oculta sin espionaje.
- **Potencia (Ronda 2):** `N^0,85 × Entrenamiento^0,6 × Armas^0,45 × Armadura^0,3 × Formación^0,3 × Moral^0,15 × Ración^0,15 × Fatiga^0,15 × Murallas × Contramedida`. Pesos de referencia P34: número 30 %, entrenamiento 20 %, armas 15 %, armadura 10 %, formación/estrategia 10 %, moral 5 %, alimentación 5 %, fatiga 5 %.
- **Rondas:** 3, con factor de bajas k = 0,40 por ronda. Retirada al perder el 70 % o bajar de 20 de moral. Empate si la diferencia de bajas relativas es ≤ 5 puntos. **Victoria aplastante: el enemigo pierde > 75 %.**
- **Heridos:** ~65 % de las bajas del jugador pasan a heridos; el resto, muertos. Los muertos se pierden para siempre.
- **Estrategias (R-08):** defensiva (ataque 0,9 / defensa 1,2) · agresiva (1,25 / 0,8) · concentración (1,1 / 1,0). Cada una vence a otra (defensiva > agresiva > concentración > defensiva) con ×1,15, dentro de 0,80–1,25.
- **Interacción entre tipos (M-11):** caballería > arqueros > infantería > caballería (+25 %); el jugador elige la fracción de cada tipo que participa. Asedio: ×1,8 contra murallas.
- **Honor y gloria (M-01):** victoria +20/+10 · aplastante +50/+30 · empate +5/0 · derrota 0/−5. La gloria decae 1/día y da +1 de moral por cada 10 (máx. +10).
- Sin botín (D-31). Sin bots PvE (D-33, M-10).
- Informe completo (P43): resultado, bajas por bando, supervivientes, explicación generada con los factores reales, honor, gloria, territorio, desgaste y recuperación prevista.

**Formaciones — cuatro tipos aprobados el 21-10-2026: ofensiva, defensiva, equilibrada y flanqueo.** Los efectos, porcentajes y matriz de ventajas están pendientes de diseño y pruebas. Este sistema **no sustituye** la matriz entre tipos de unidad sino que se suma:

| Formación | Idea | Fuerte contra | Débil contra |
|---|---|---|---|
| Ofensiva | Prioriza infligir daño y romper la línea enemiga | Por calcular | Por calcular |
| Defensiva | Prioriza reducir bajas propias y resistir | Por calcular | Por calcular |
| Equilibrada | Sin especialización extrema; respuesta flexible | Por calcular | Por calcular |
| Flanqueo | Busca atacar los laterales y desorganizar al rival | Por calcular | Por calcular |

No fijar todavía modificadores numéricos ni cruces de ventaja: deben calcularse, incorporarse a `balanceConfig.ts` y validarse con simulaciones.

---

## 14. Parlamento y diplomacia (P38–P42, P58, P60, D-34 a D-42)

- **Sin ataques sorpresa.** Todo PvP importante pasa por el Parlamento (nivel 1 para enviar o recibir desafíos).
- **Máquina de estados** (server-authoritative): `PENDING → ACCEPTED / REJECTED → FROZEN → RESOLVED`. Transiciones validadas en servidor; resolución idempotente.
- Un desafío incluye rival, fecha, hora, condiciones. **Aceptado: tres fechas** a 1, 3 y 7 días reales. Un desafío pendiente caduca a los 7 días reales (R-10).
- **Rechazar:** pierde un **2 % de cada recurso** (mínimo 10, máximo 500 por recurso; nunca por debajo de 0). No se penalizan población ni tropas.
- **Congelación del contingente** 15 minutos reales antes del combate.
- **Límites:** máximo 3 desafíos pendientes por reino; enfriamiento de 24 h reales contra el mismo rival.
- **Apuestas:** desactivadas (M-08). Sin apuestas ni territorio en juego.
- **Espionaje (D-39):** sin Espionaje I, intervalo de efectivos con error ±25 %; con I, ±15 %; con II, ±7 %. Coste por informe: 100 oro (I) / 250 oro (II). Caduca a las 24 h.
- **Distancia (P41):** hexagonal. Marcha: `1.800 s × distancia × multiplicador`; fatiga por marcha `+2 × d` (terreno neutro, R-14).
- **Notificaciones:** insignia en Parlamento con los desafíos pendientes (`Parlamento 🔴1`).
- **Comunicación (P60):** sin chat libre; solo cinco mensajes: «¿Te atreves a retarme?» · «Mi reino está preparado.» · «Buena suerte.» · «¿Eso es todo?» · «Nos veremos en el campo de batalla.»

---

## 15. Heridos, hospital y muertos (P44–P46)

Los heridos salen del ejército, no combaten y se muestran aparte. **Hospital militar — % de heridos recuperados por año:** nivel 1: 15 % · 2: 22 % · 3: 30 % · 4: 40 % · 5+: 50 %. Medicina y tecnologías suman (tope 60 %). Los recuperados vuelven al ejército.

---

## 16. Mapa, territorios y exploración (P41, P47–P49, D-22 a D-26, R-06, R-07)

- Mapa **hexagonal** con coordenadas axiales `(q, r)`, radio 10: **331 celdas**. Semilla de mundo reproducible. Distancia: `(|Δq| + |Δr| + |Δq+Δr|)/2`.
- Terrenos: llanura (+10 % agricultura) · bosque (+15 % madera) · colina (+10 % piedra) · montaña (+15 % hierro, +10 % defensa) · río (+10 % agricultura) · costa (+10 % comercio).
- Colocación de reinos: el primero en el centro; cada nuevo reino en la celda libre más alejada de los territorios principales.
- **Territorios libres:** sin propietario. Tras una **victoria aplastante** se puede reclamar uno **cercano (distancia ≤ 2) y ya explorado**. Al reclamarlo pasa a territorios del reino. **No se roba el territorio principal enemigo.** Si dos jugadores lo reclaman a la vez, gana el primero que llega al servidor.
- **Exploración (en alcance, decisión del responsable):** expedición de reconocimiento con coste en oro y comida, un explorador civil y marcha de 1.800 s por hexágono. Desvela la niebla de guerra. Cancelar devuelve el 50 %. Una expedición a la vez.

---

## 17. Misiones, honor y bonus (P3, P50, P51, P59)

### Decisiones funcionales cerradas (21-10-2026)

- **Bonus diario existente:** +5 honor, una vez cada 24 h; validado en servidor. No confundirlo con las misiones diarias.
- **Misiones progresivas por etapas:** se desbloquean poco a poco conforme el jugador avanza. No se muestran por adelantado todas las misiones futuras. Los objetivos pueden incluir edificios construidos o mejorados, niveles alcanzados, investigaciones completadas, tamaño del ejército, tropas entrenadas y batallas ganadas.
- **Completado automático:** el servidor detecta el cumplimiento del objetivo, marca la misión completada y concede la recompensa automáticamente. No hay botón de reclamar. La recompensa de cada misión única se entrega una sola vez, mediante una operación atómica validada en servidor.
- **Celebración visual:** al completar una misión aparece una animación breve con el nombre del logro y sus recompensas. No debe bloquear ni interrumpir la partida. Al terminar una etapa, se muestra también su premio final.
- **Recompensas individuales y de etapa:** recursos, oro, honor y gloria; además, según dificultad y etapa, tropas gratuitas, objetos únicos o bonificaciones temporales. Completar todas las misiones requeridas de una etapa concede una recompensa adicional.
- **Misiones secretas:** sus condiciones y existencia permanecen ocultas hasta que se cumplen. Entonces se revela el logro con una celebración y recompensa automática. Cada misión secreta única se concede una sola vez.
- **Misiones secretas por civilización:** cada civilización tendrá el mismo número de misiones secretas exclusivas. Su temática y recompensas pueden reflejar su identidad histórica, pero el valor y la utilidad deben equilibrarse para que ninguna sea superior por tener más oportunidades.
- **Misiones diarias:** se renuevan cada día y conceden recompensas adicionales. Todos los jugadores reciben el mismo conjunto de objetivos y las mismas recompensas, sin adaptación por nivel de reino. Los objetivos deberán elegirse para que sean razonablemente alcanzables por jugadores en distintas fases, sin exigir capacidades avanzadas a todos. El reinicio diario no borra el progreso permanente. La hora/zona de reinicio se fijará en el diseño técnico antes de implementar.
- **Equilibrio y seguridad:** las cantidades de premios, duración de las bonificaciones y catálogo se deben definir y centralizar en `convex/balanceConfig.ts`, con etiqueta de origen `[DECISIÓN 2026-10-21]` o `[DERIVADO]`. El servidor es la autoridad; no confiar en el cliente para completar misiones, conceder premios o impedir duplicados.
- **Estado:** estas reglas están aprobadas como diseño, pero el sistema de misiones sigue pendiente de implementación y verificación. No afirmar que ya funciona en el juego.

### Catálogo inicial orientativo (a desarrollar y equilibrar)

- **Progreso permanente:** primera Vivienda; Granja nivel 3; Castillo nivel 2; primera investigación; alcanzar una población determinada; entrenar un número acumulado de tropas; primer desafío; primera victoria; hitos de batallas ganadas.
- **Objetivos militares y de desarrollo:** alcanzar umbrales de ejército, investigar tecnologías, subir edificios a niveles definidos y ganar varias batallas. Evitar objetivos ambiguos o que puedan contabilizarse dos veces.
- **Diarias:** seleccionar un conjunto idéntico para todos, con objetivos de economía, construcción, investigación y actividad militar alcanzables. El catálogo y las cantidades concretas están pendientes.
- **Secretas:** condiciones especiales no visibles antes de completarse; número idéntico por civilización, con tema y premio adaptados.
- No fijar aún cantidades concretas de recursos, oro, honor, gloria, tropas, objetos ni duración de bonificaciones sin calcular su impacto en la economía y el equilibrio.

---

## 18. Interfaz (P11, P64, P70)

- Pantalla principal: **Aldea/Reino**. Barra superior (se actualiza sola): reino · monarca · año · oro · madera · piedra · hierro · alimentos · población.
- Navegación inferior: 🏰 Aldea · ⚔️ Ejército · 🎓 Universidad · 🏛️ Parlamento · 🗺️ Mapa.
- Clara, rápida, **legible en móvil (móvil primero)**, visualmente medieval, sin saturación de botones. Diseño adaptable para ordenador.

---

## 19. Parámetros ajustables (P72)

Todos en `convex/balanceConfig.ts`: población inicial, crecimiento, capacidad y producción de edificios, costes y factores por nivel (`COST_GROWTH_PER_LEVEL = 0,15`, duración +1 %), ranuras de obra (`MAX_CONCURRENT = 2`) y de investigación, consumo de alimentos, impuestos, felicidad y moral, heridos (65 %) y recuperación, combate (k, rondas, exponentes, tolerancia de empate, umbrales), estrategias y matriz de tipos, mercenarios, políticas de descanso, estaciones, almacén, mapa y exploración, Parlamento (`REJECTION_PENALTY_RATIO = 0,02`), honor y gloria, civilizaciones.

---

## 20. Reglas inquebrantables

- ❌ Nunca un botón para avanzar el tiempo.
- ❌ Nunca construcción instantánea.
- ❌ Nunca más de **2 obras** a la vez ni más investigaciones que las **ranuras de la Universidad**.
- ❌ Nunca ataques sorpresa PvP: todo pasa por el Parlamento.
- ❌ Nunca eliminar la partida por una derrota.
- ❌ Nunca controlar soldados o ciudadanos individualmente.
- ❌ Nunca mejoras infinitas sin progresión.
- ❌ Nunca contraseñas en texto plano ni secretos en el repositorio.
- ❌ Nunca que el cliente decida el tiempo, los recursos, las tropas o los resultados.
- ❌ Nunca una acción entre jugadores que no se valide en servidor de forma atómica.
- ❌ Nunca una civilización objetivamente superior.
- ❌ Nunca desplegar, migrar o tocar Iberia sin autorización expresa.
- ❌ Nunca sumar `armyUnits` y `regularSoldiers`.
- ✅ Todo número de balance, en `balanceConfig.ts` y etiquetado.
- ✅ Toda acción muestra: qué hace → coste → duración → resultado.

---

## 21. Decisiones, propuestas y puntos abiertos

### Decisiones cerradas (no reabrir)
- **Población inicial 2.000.** Mundo web multijugador persistente, con el servidor como autoridad.
- **Backend: Convex.** Appwrite descartado.
- **Inicio de sesión:** nombre de gobernante + contraseña, sin verificación por Gmail/Google. Crear cuenta, iniciar sesión e invitado en la pantalla inicial. La implementación debe verificarse por separado.
- **Recuperación de cuenta:** mostrar un código de recuperación una sola vez al crear la cuenta; el jugador debe guardarlo. No depender del correo. Implementación pendiente.
- **Modo invitado permitido**, para ver el juego/civilizaciones con aviso claro de que el progreso no se guarda.
- **Obras:** 2 simultáneas. **Investigaciones:** ranuras según Universidad (1/2/3).
- **Costes de edificio +15 % por nivel; duración +1 % por nivel.** Sustituye a +25 % / +10 %.
- **Rechazar un desafío:** −2 % de cada recurso, mínimo 10 y máximo 500.
- **Exploración:** en alcance y reportada como implementada; mantener la distinción entre informe previo y verificación actual.
- **Sin salarios militares**, incluidos los mercenarios: se paga al contratarlos y no hay sueldo diario. **Sin bots PvE, apuestas ni efectos climáticos por ahora.** Estaciones solo informativas. Sin temporadas competitivas ni rankings por temporada.
- **Nombres de civilizaciones:** «Keniatas» pasa a **Masáis**; «Indios americanos» pasa a **Navajos**; **Aztecas** sigue siendo una civilización separada.
- **Civilizaciones:** cada una tendrá una ventaja y una debilidad. Los porcentajes concretos se diseñarán y equilibrarán después. Se contemplan armas, armaduras, edificios y soldados propios, pendientes de diseño/implementación.
- **Formaciones militares:** cuatro tipos: ofensiva, defensiva, equilibrada y flanqueo. Sus efectos y porcentajes quedan pendientes de diseño y pruebas.
- **Misiones:** progresivas por etapas, desbloqueadas poco a poco; objetivos detectados automáticamente; recompensa automática sin reclamación manual ni duplicados; animación breve con nombre y premios; recompensa adicional al completar cada etapa; recompensas posibles de recursos, oro, honor, gloria, tropas, objetos únicos y bonificaciones temporales.
- **Misiones secretas:** condiciones ocultas hasta completarse; recompensa y celebración automáticas; pueden conceder recompensas exclusivas relacionadas con la civilización. Todas las civilizaciones tendrán el mismo número de misiones secretas, con valor de recompensas equilibrado.
- **Misiones diarias:** mismo conjunto de objetivos y mismas recompensas para todos los jugadores; se renuevan cada día; no borran el progreso permanente. La hora de reinicio, catálogo y cantidades están pendientes de especificación.
- **Honor/gloria:** mantener como referencia la tabla M-01 hasta que una revisión de balance justifique cambios.
- **P56 y P61:** siguen pendientes de aclaración documental; no inventar requisitos para esos puntos.

### Propuestas pendientes de diseño o implementación (no son funciones ya disponibles)
- Singularidades de armas, armaduras, soldados y edificios por civilización, respetando el dossier histórico.
- Matriz de ventajas y desventajas de las cuatro formaciones.
- Catálogo completo, etapas, condiciones secretas, recompensas, reglas de reinicio y pruebas del sistema de misiones.
- Definir tipos y precios de mercenarios ligados al nivel de la Taberna; sin salario diario.
- Aclarar el alcance exacto del modo invitado, manteniéndolo fuera del mundo compartido si no guarda progreso.

### Puntos abiertos (preguntar una sola vez, con propuesta)
1. **Despliegue real de Convex y publicación del cliente web (T-02):** requieren autorización expresa. Lo mismo para migraciones de reinos existentes.
2. **Terreno intermedio en las marchas (R-14)** y valores finales de murallas.
3. **Valores numéricos y equilibrio:** porcentajes de ventajas/debilidades de civilización, efectos de formaciones, cantidades de recompensas, límites y duración de bonificaciones temporales.
4. **Misiones diarias:** fijar la hora de reinicio del servidor y el catálogo común antes de implementarlas.

### Fuera de alcance (descartado)
- Salarios militares. Bots PvE. Apuestas. Efectos del clima (de momento). Temporadas competitivas, títulos y rankings de temporada.
