# LA CONQUISTA --- ACTUALIZACIONES Y PLAN DE TRABAJO

**Fecha:** 18 de noviembre de 2026\
**Proyecto:** La Conquista\
**Repositorio de referencia:** `nachosunen-maker/La-Conquista-2`\
**Documento:** Especificación de las ocho líneas de actualización

------------------------------------------------------------------------

## Objetivo y alcance

Este documento reúne en ocho puntos las actualizaciones acordadas para
el juego y concreta qué debe revisarse, implementarse y probarse en cada
una.

**Regla de trabajo:** no rehacer sistemas que ya funcionen. Primero se
inspeccionará el código real, se identificarán las partes correctas y
las deficiencias, y después se harán cambios localizados. Cada punto
deberá terminar con pruebas y evidencias verificables.

**Estado de publicación:** a fecha de este documento, la última revisión
comunicada de GitHub no mostraba todavía incorporado el conjunto de
cambios descrito en el informe reciente de IA Studio. Por tanto, este
documento define el trabajo requerido; no certifica que esté
implementado ni publicado.

## Reglas generales obligatorias

1.  Trabajar sobre el proyecto existente y respetar su arquitectura,
    datos y funcionalidades válidas.
2.  No eliminar, sustituir ni simplificar características existentes sin
    una necesidad demostrada y autorización expresa.
3.  No reducir el mapa. El tamaño objetivo es **7.651 hexágonos**,
    correspondiente a un mapa hexagonal de radio 50.
4.  No cambiar fórmulas históricas de economía, construcción, combate o
    progresión salvo que se detecte un error y se documente antes de
    corregirlo.
5.  Mantener la integridad de los datos de jugadores, reinos,
    territorios, ejércitos, colas, investigaciones e historiales.
6.  Las reglas críticas deben validarse en backend; el cliente no puede
    decidir por sí solo recursos, propiedad territorial, resultados
    militares, tiempos o recompensas.
7.  No tocar infraestructura, alojamiento, credenciales, variables de
    entorno ni despliegues durante estos ocho puntos.
8.  No realizar la migración al servidor local hasta que los siete
    puntos anteriores estén implementados, revisados y probados.
9.  No dar por ejecutada una prueba porque exista un archivo de test o
    porque un informe diga que pasó. Registrar qué comandos se
    ejecutaron realmente y sus resultados.
10. Entregar al final un resumen de archivos modificados, decisiones
    técnicas, pruebas ejecutadas, resultados y limitaciones pendientes.

------------------------------------------------------------------------

# PUNTO 1 --- EJÉRCITO Y SISTEMA DE ESPÍAS

## Objetivo

Separar completamente el reclutamiento de espías del entrenamiento
militar ordinario. Los espías deben ser una unidad especializada, con su
propio procedimiento de reclutamiento y límites de capacidad.

## Trabajo requerido

### 1.1. Auditar todos los caminos de creación de unidades

-   Localizar el catálogo general de unidades y todos los tipos de
    unidad admitidos.
-   Identificar todas las mutaciones, acciones, colas y funciones que
    permiten entrenar, reclutar, reforzar, transferir o desplegar
    tropas.
-   Comprobar que el espía no aparece como unidad entrenable en
    barracones ni en formularios de entrenamiento ordinario.
-   Comprobar que no puede introducirse manipulando directamente una
    petición al backend.
-   Revisar también ataques, marchas, refuerzos, recompensas y cualquier
    conversión de unidades para impedir que se creen espías por una vía
    secundaria.

### 1.2. Reclutamiento especializado

-   Mantener una acción específica de reclutamiento de espías.
-   Validar en servidor que el jugador tiene los requisitos y recursos
    necesarios.
-   Aplicar el límite de capacidad del edificio o sistema especializado
    correspondiente.
-   Calcular correctamente las unidades ya reclutadas, las que están
    ocupando capacidad, las que permanecen en cola y las que están
    asignadas a misiones.
-   Evitar que dos solicitudes simultáneas superen la capacidad.
-   Impedir cantidades negativas, valores no enteros, duplicaciones o
    solicitudes repetidas.

### 1.3. Misiones y disponibilidad

-   Comprobar que un espía asignado a una misión no puede utilizarse
    simultáneamente en otra misión ni contarse como disponible.
-   Definir claramente cuándo vuelve a estar disponible al finalizar,
    cancelar o fallar una misión.
-   Mantener la persistencia de las misiones y de los espías asignados.
-   Evitar que un error o reintento duplique espías o libere capacidad
    incorrectamente.

## Pruebas de aceptación

-   El entrenamiento normal no puede crear espías.
-   La acción especializada sí puede reclutarlos si se cumplen los
    requisitos.
-   Nunca se supera la capacidad, incluso con peticiones concurrentes.
-   Un espía ocupado en una misión no puede desplegarse de nuevo.
-   Cancelaciones, fallos y reintentos no duplican unidades ni
    capacidad.
-   La interfaz muestra cantidades disponibles, ocupadas y en cola de
    forma coherente con el servidor.

------------------------------------------------------------------------

# PUNTO 2 --- LÍMITE DE TERRITORIOS POR REINO Y SANEAMIENTO DE DATOS

## Objetivo

Establecer un máximo absoluto de **100 hexágonos por reino**,
aplicándolo a todas las formas de adquisición y conservando
correctamente los datos históricos y las relaciones del juego.

## Trabajo requerido

### 2.1. Regla única de límite

-   Definir el máximo en una configuración central compartida por las
    operaciones relevantes.
-   Aplicar la validación en reclamación de territorios libres,
    conquistas, resolución de marchas, recompensas y cualquier otra vía
    de asignación.
-   Validar el límite en backend, no solo deshabilitando botones en la
    interfaz.
-   Comprobar el límite dentro de la operación que modifica la propiedad
    para evitar que dos conquistas simultáneas permitan alcanzar 101 o
    más territorios.
-   Rechazar operaciones que excedan el límite sin dejar escrituras
    parciales.

### 2.2. Saneamiento de reinos que ya superen el límite

Crear un procedimiento controlado, repetible e idempotente para detectar
y corregir reinos que ya tengan más de 100 territorios.

Criterio de conservación:

1.  Conservar siempre la capital.
2.  Conservar los 99 territorios restantes más próximos a la capital.
3.  Resolver empates mediante un criterio determinista y estable, por
    ejemplo el identificador del territorio.
4.  No cambiar la capital ni reasignarla accidentalmente.
5.  No borrar datos de jugadores ni registros históricos que deban
    conservarse.

### 2.3. Integridad referencial

Antes de liberar o eliminar la propiedad de un territorio sobrante,
identificar todas las entidades que lo referencian:

-   marchas y movimientos;
-   batallas e informes;
-   edificios o estructuras asociadas;
-   bonificaciones y producción;
-   rutas, objetivos y coordenadas guardadas;
-   referencias de capital y territorio de origen;
-   cualquier otra tabla o documento dependiente.

Definir para cada relación si debe actualizarse, conservarse como
histórico o eliminarse de forma segura. No dejar referencias huérfanas.

### 2.4. Seguridad operativa

-   El saneamiento debe requerir autorización administrativa real en
    servidor.
-   El modo de simulación (`dry run`) debe ser el comportamiento
    predeterminado.
-   La simulación debe informar de cuántos reinos y territorios se
    verían afectados, sin escribir cambios.
-   La ejecución efectiva debe requerir una confirmación explícita y
    volver a validar los datos antes de escribir.
-   Registrar fecha, operador, reino, territorios conservados y
    territorios liberados.
-   Permitir ejecutar de nuevo el procedimiento sin alterar el resultado
    ya saneado.
-   Excluir únicamente los reinos de demostración que estén
    identificados de forma inequívoca y documentada; no excluir usuarios
    reales por coincidencias de nombre.

## Pruebas de aceptación

-   Ningún reino puede superar 100 territorios por reclamación,
    conquista o concurrencia.
-   Un reino con 100 territorios conserva todos; una adquisición
    adicional se rechaza.
-   Un reino con más de 100 conserva capital y los 99 más próximos.
-   El modo de simulación no modifica ningún dato.
-   La ejecución no deja referencias huérfanas ni pierde historiales.
-   Repetir el saneamiento no produce cambios adicionales.

------------------------------------------------------------------------

# PUNTO 3 --- MAPA MUNDIAL DEFINITIVO Y DISTRIBUCIÓN GEOGRÁFICA

## Objetivo

Restaurar y mantener el mapa mundial completo de **7.651 hexágonos,
radio 50**, y organizar la distribución inicial de civilizaciones y
reinos para que el mundo tenga una geografía coherente y espacio de
expansión.

## Trabajo requerido

### 3.1. Tamaño y geometría

-   Configurar el radio del mapa en 50.
-   Verificar que la generación produce exactamente 7.651 celdas
    hexagonales.
-   Comprobar que las coordenadas axiales/cúbicas son válidas, que no
    existen duplicados y que todas las celdas pertenecen al contorno
    esperado.
-   Revisar cualquier límite antiguo de radio 25, límite de celdas,
    paginación o filtro que siga reduciendo el mundo.
-   Comprobar que backend, generación del mundo, consultas, cliente,
    minimapa y herramientas de administración usan la misma definición
    del mapa.
-   No sustituir el mapa grande por una vista parcial que se presente
    como si fuera el mundo completo.

### 3.2. Regiones de civilización

-   Agrupar las civilizaciones en regiones reconocibles del mapa.
-   Definir anclas o zonas de origen estables para cada civilización.
-   Evitar que la selección inicial coloque reinos fuera de su región
    sin una razón de diseño.
-   Mantener una distribución reproducible mediante semilla, para que
    los resultados puedan auditarse y probarse.
-   Documentar las regiones, sus anclas y los criterios de selección.

### 3.3. Separación entre reinos

-   Buscar una separación inicial objetivo de **20 a 30 hexágonos entre
    reinos**, según la métrica de distancia hexagonal definida por el
    juego.
-   Aclarar si la distancia se mide entre capitales, bordes de
    territorio inicial o zonas de influencia. Utilizar una única
    definición en generación, validación y pruebas.
-   Evitar solapamientos y posiciones iniciales injustas.
-   Analizar la capacidad geométrica real del mapa: no afirmar que la
    separación se garantiza siempre si el número de reinos o la forma de
    las regiones lo hace imposible.
-   Cuando no exista una colocación que cumpla el objetivo, devolver un
    diagnóstico explícito y aplicar una degradación controlada y
    documentada, sin bucles infinitos ni ubicaciones inválidas.

### 3.4. Inicio del jugador

-   Al abrir el mapa, centrarlo en la capital o territorio principal del
    jugador.
-   Mostrar claramente la zona inicial y los territorios propios.
-   Si aún no existe reino o capital, mostrar el estado de
    selección/fundación correspondiente, sin centrar en coordenadas
    arbitrarias.
-   Mantener el comportamiento correcto al cambiar de pantalla, recargar
    o volver al mapa.

## Pruebas de aceptación

-   La generación contiene exactamente 7.651 hexágonos.
-   No hay coordenadas duplicadas ni huecos dentro de la geometría
    definida.
-   Las regiones y anclas son reproducibles.
-   La distribución informa de las distancias reales y de las
    excepciones.
-   No se reduce el mapa para resolver problemas de rendimiento.
-   El mapa abre centrado en la posición real del jugador.

------------------------------------------------------------------------

# PUNTO 4 --- RENDIMIENTO, ESCALABILIDAD Y REDISEÑO DE LA INTERFAZ DEL MAPA

## Objetivo

Conservar el mundo de 7.651 hexágonos y mejorar sustancialmente la
velocidad, legibilidad, navegación y experiencia del mapa, especialmente
en dispositivos móviles.

## Trabajo requerido

### 4.1. Diagnóstico de rendimiento

-   Medir el tiempo de carga inicial, tiempo de renderizado, memoria y
    fluidez al mover o ampliar el mapa.
-   Probar con el mapa completo, con muchos reinos y con diferentes
    densidades de territorios ocupados.
-   Identificar consultas, suscripciones y renderizados que se repitan
    sin necesidad.
-   Establecer una referencia antes de optimizar y comparar los
    resultados después.

### 4.2. Backend y transferencia de datos

-   Evitar enviar repetidamente datos estáticos que el cliente puede
    reconstruir de forma determinista, siempre que la semilla y la
    configuración estén versionadas y sean compatibles.
-   Consultar solo los datos dinámicos necesarios: propiedad, ocupación,
    estado y demás información que realmente cambie.
-   Revisar índices y consultas por propietario para evitar consultas
    individuales costosas por cada reino.
-   Evitar lecturas completas repetidas cuando una consulta compacta o
    paginada resuelva el caso.
-   Reducir suscripciones innecesarias desde paneles que no estén
    visibles o no necesiten esos datos.
-   Mantener consistencia entre los datos compactos del mapa y las
    consultas detalladas de cada territorio.

### 4.3. Renderizado del cliente

Evaluar y aplicar, con mediciones, las técnicas que resulten adecuadas:

-   Canvas u otra tecnología de renderizado eficiente, sin imponer un
    cambio tecnológico si no mejora el resultado.
-   *Viewport culling*: no dibujar hexágonos fuera de la zona visible.
-   *Level of Detail* (LOD): simplificar detalles en niveles de zoom
    alejados.
-   Precálculo de geometría y reutilización de objetos.
-   Memoización de cálculos que no cambian.
-   Redibujado selectivo cuando cambian territorios concretos.
-   Uso correcto de `devicePixelRatio` sin multiplicar innecesariamente
    el coste.
-   Gestión eficiente de eventos táctiles, ratón, desplazamiento y zoom.
-   Limpieza de listeners, referencias y recursos al desmontar el
    componente.

### 4.4. Interfaz y navegación

-   Ampliar y mejorar la interfaz del mapa; no reducir el tamaño del
    mundo ni ocultar permanentemente información necesaria.
-   Hacer que el mapa sea legible en móvil y escritorio.
-   Mejorar zoom, desplazamiento, centrado, selección de hexágonos y
    retorno a la capital.
-   Diferenciar visualmente capitales, territorios propios, territorios
    libres, reinos rivales, regiones y elementos especiales.
-   Proporcionar información contextual al seleccionar un hexágono:
    propietario, tipo, distancia, estado y acciones disponibles, según
    corresponda.
-   Evitar que los controles tapen zonas importantes del mapa.
-   Mantener controles táctiles cómodos y una navegación fluida.
-   Añadir estados de carga, error y ausencia de datos comprensibles.
-   Revisar contraste, tamaño de texto, jerarquía visual y consistencia
    con la estética medieval del juego.

### 4.5. No regresión

-   La selección de un hexágono debe identificar el territorio correcto.
-   El zoom no debe desplazar el punto seleccionado de forma inesperada.
-   La posición del jugador debe seguir siendo accesible.
-   Las acciones territoriales deben usar identificadores reales y
    validarse en servidor.
-   No sacrificar precisión geográfica por mejorar los FPS.

## Pruebas de aceptación

-   El mapa completo sigue teniendo 7.651 celdas.
-   Se documentan mediciones antes y después.
-   No hay pérdida de selección, coordenadas ni acciones.
-   Funciona con ratón y pantalla táctil.
-   No existen suscripciones o consultas repetitivas evitables.
-   La experiencia mejora sin reducir el contenido del mundo.

------------------------------------------------------------------------

# PUNTO 5 --- PROGRESIÓN DE EDIFICIOS HASTA NIVEL 200

## Objetivo

Permitir que los edificios alcancen un nivel máximo de **200**,
manteniendo las fórmulas matemáticas históricas de costes, tiempos,
producción, requisitos y progresión del proyecto.

## Trabajo requerido

### 5.1. Auditoría de límites

-   Localizar todos los límites de nivel de edificios en backend,
    frontend, validadores, formularios, configuración, adaptadores,
    colas y pruebas.
-   Buscar límites fijos antiguos, valores máximos en controles
    numéricos, validaciones duplicadas y condiciones que bloqueen
    niveles superiores.
-   Definir un único máximo central: 200.
-   Comprobar que ningún módulo mantiene un límite incompatible.

### 5.2. Fórmulas y balance

-   Mantener las fórmulas matemáticas históricas del proyecto.
-   No sustituirlas por progresiones lineales, exponenciales nuevas o
    costes arbitrarios para facilitar la implementación.
-   Revisar con especial atención redondeos, desbordamientos numéricos,
    precisión y límites de tipos de datos.
-   Comprobar costes, duración, producción, capacidad, consumo,
    bonificaciones y requisitos en niveles altos.
-   Mantener los requisitos de Castillo, Universidad, edificios
    especializados y tecnologías.
-   No permitir que el nivel 200 se alcance ignorando requisitos de
    progresión.
-   Documentar cualquier fórmula que no soporte el rango 1--200 y
    proponer una corrección compatible antes de modificarla.

### 5.3. Interfaz

-   Permitir visualizar y solicitar mejoras hasta nivel 200.
-   Mostrar nivel actual, siguiente nivel, requisitos, coste, duración y
    efecto esperado.
-   Evitar controles que se queden bloqueados por un máximo antiguo.
-   Comprobar que las colas y la persistencia aceptan niveles
    superiores.
-   Mantener la presentación legible en móvil.

## Pruebas de aceptación

-   Los niveles 1--200 se validan correctamente.
-   El nivel 201 se rechaza en backend y frontend.
-   Las fórmulas históricas producen resultados coherentes.
-   Los requisitos siguen aplicándose.
-   Colas, guardado, producción y visualización funcionan en niveles
    altos.
-   No hay errores de precisión, desbordamiento o costes negativos.

------------------------------------------------------------------------

# PUNTO 6 --- COMPENSACIÓN ÚNICA POR LA CAÍDA DEL SERVIDOR

## Objetivo

Entregar una compensación de **30.000 unidades de cada recurso** a cada jugador elegible, mediante un proceso manual, único y persistente por cuenta, condicionado estrictamente a disponer de capacidad de almacenamiento suficiente para los cinco recursos simultáneamente.

## Reglas definitivas y funcionamiento

- Todos los jugadores con cuenta válida tienen derecho a la compensación, excepto cuentas demo identificadas inequívocamente.
- El jugador decide cuándo recibirla pulsando el botón «Recibir regalo único».
- Se entregan exactamente 30.000 unidades de oro, madera, piedra, hierro y comida.
- El derecho es único y persistente por cuenta.
- Se exige espacio suficiente para los cinco recursos simultáneamente.
- Si falta espacio para cualquiera de ellos, no se acredita ninguno (cero entregas parciales).
- El jugador puede liberar espacio y volver a intentarlo.
- No existe entrega automática al fundar, inicializar o reiniciar un reino.
- La capacidad no verificable es un problema técnico transitorio, no una pérdida del derecho.
- El backend es la autoridad definitiva de validación y acreditación.
- La consulta de estado de compensación es estrictamente de solo lectura y no modifica recursos almacenados.

## Pruebas de aceptación

- Cada jugador elegible con cuenta válida puede reclamar manualmente su compensación pulsando «Recibir regalo único».
- Se entregan exactamente 30.000 unidades de oro, madera, piedra, hierro y comida de forma atómica.
- Si falta capacidad para uno o más recursos, el servidor rechaza el cobro íntegramente y no entrega ningún recurso.
- Las llamadas repetidas, concurrentes o reintentos no duplican la compensación (idempotencia garantizada).
- No existe entrega automática al fundar, inicializar o reiniciar un reino.
- Si la proyección económica falla o lanza una excepción, la consulta devuelve `capacityVerifiable: false`, `capacityReport: null` y `canClaim: false` sin modificar los recursos almacenados.
- Una vez recuperada la proyección y disponible el espacio necesario, el jugador puede volver a verificar y cobrar con éxito.

------------------------------------------------------------------------

# PUNTO 7 --- AUDITORÍA DE ELEMENTOS GRÁFICOS E IMÁGENES PERSONALIZADAS

## Objetivo

Identificar todos los elementos del juego que podrían utilizar imágenes
personalizadas en una fase posterior. En esta etapa se debe producir
documentación técnica, no generar ni incorporar imágenes.

## Trabajo requerido

### 7.1. Inventario completo

Inspeccionar el código y localizar elementos gráficos de:

-   Edificios y sus estados, niveles o variantes.
-   Unidades militares, tipos de tropa, equipamiento y variantes por
    civilización.
-   Civilizaciones, culturas, escudos, banderas y emblemas.
-   Personajes, monarcas, consejeros, comandantes y personajes
    secundarios.
-   Tecnologías e investigaciones.
-   Recursos, mercancías, materiales y productos.
-   Mapa, terrenos, biomas, montañas, bosques, agua, fronteras y
    elementos especiales.
-   Iconos, botones, paneles, fondos, ventanas y elementos de
    navegación.
-   Misiones, desafíos, logros, recompensas y eventos.
-   Comercio, diplomacia, Parlamento y relaciones entre reinos.
-   Pantallas de inicio, carga, tutorial y bienvenida.
-   Cualquier elemento adicional detectado en el código.

### 7.2. Ficha por elemento

Para cada elemento registrar:

1.  Nombre y función dentro del juego.
2.  Archivo, componente y ruta exacta donde se representa.
3.  Representación actual: icono, emoji, SVG, CSS, imagen, componente o
    recurso generado.
4.  Si ya admite sustituir la representación por una imagen.
5.  Cambios técnicos necesarios para soportar imágenes.
6.  Dimensiones y relación de aspecto recomendadas.
7.  Formato recomendado y necesidad de transparencia.
8.  Variantes necesarias por nivel, estado, civilización, orientación o
    contexto.
9.  Número estimado de imágenes distintas.
10. Prioridad de producción: alta, media o baja.

### 7.3. Arquitectura de recursos

-   Recomendar una estructura ordenada de carpetas y nombres de archivo.
-   Proponer un identificador estable para cada recurso gráfico.
-   Evitar referencias a imágenes dispersas y rutas duplicadas.
-   Diseñar una forma de sustituir iconos actuales por imágenes sin
    reescribir la lógica de juego.
-   Separar los datos de presentación de las reglas económicas,
    militares y de progresión.
-   Indicar cómo gestionar variantes, fallback si falta una imagen y
    carga eficiente.
-   Considerar el peso de los recursos y su rendimiento en Android y
    web.

### 7.4. Entregable

Crear un documento Markdown de auditoría dentro del proyecto, con
inventario, rutas, recomendaciones, cantidades estimadas y prioridades.
Debe ser suficientemente detallado para producir posteriormente las
imágenes sin volver a inspeccionar todo el código.

**No generar, descargar ni incorporar imágenes en esta fase.** La
producción e integración de imágenes se realizará más adelante, después
de la migración al entorno local.

## Pruebas de aceptación

-   El inventario cubre todos los módulos visuales encontrados.
-   Cada elemento tiene ubicación verificable en el código.
-   Las cantidades se presentan como estimaciones justificadas, no como
    cifras inventadas.
-   Se distinguen recursos ya existentes de recursos que habría que
    crear.
-   No se han añadido imágenes ni se ha alterado la presentación
    existente sin autorización.

------------------------------------------------------------------------

# PUNTO 8 --- MIGRACIÓN AL SERVIDOR LOCAL Y ENTORNO DE DESARROLLO

## Objetivo

Preparar y realizar la migración únicamente cuando los puntos 1--7 estén
terminados y validados. Esta fase debe mantenerse separada del trabajo
funcional anterior.

## Condición de inicio

No comenzar esta fase hasta que:

-   Los puntos 1--7 estén implementados.
-   Las pruebas unitarias, de integración y de regresión estén
    ejecutadas y documentadas.
-   Se haya revisado el código real publicado.
-   No queden errores críticos de integridad, seguridad, persistencia o
    funcionamiento.
-   Exista una copia de seguridad verificable y un plan de reversión.

## Trabajo requerido

### 8.1. Evaluación previa

-   Inventariar arquitectura, servicios, dependencias, almacenamiento,
    autenticación, variables de entorno y despliegues actuales.
-   Identificar qué componentes deben migrarse y cuáles deben
    mantenerse.
-   Comparar alternativas de alojamiento y costes operativos.
-   Analizar límites de recursos, almacenamiento, conexiones, tráfico,
    tareas programadas y crecimiento de la base de datos.
-   No asumir que un servidor local es obligatorio ni elegir proveedor
    sin comparar opciones y justificar la decisión.

### 8.2. Plan de migración

-   Definir destino, arquitectura, servicios y responsabilidades.
-   Preparar procedimiento de exportación, transformación si procede e
    importación de datos.
-   Preservar identificadores, relaciones, cuentas, reinos, territorios,
    recursos, ejércitos, colas e historiales.
-   Definir estrategia de sincronización y ventana de corte.
-   Establecer un procedimiento de reversión si la validación falla.
-   No borrar el entorno anterior hasta verificar la integridad y el
    funcionamiento del nuevo.

### 8.3. Seguridad y configuración

-   Gestionar secretos mediante mecanismos seguros; nunca incorporarlos
    al repositorio.
-   Revisar autenticación, autorización, reglas de acceso y permisos
    administrativos.
-   Configurar copias de seguridad y restauración.
-   Configurar registros, alertas, métricas y límites de consumo.
-   Revisar protección frente a abuso, duplicación de operaciones y
    accesos no autorizados.

### 8.4. Validación posterior

-   Verificar cuentas y sesiones.
-   Comparar recuentos y relaciones de datos antes y después.
-   Probar economía, tiempo, construcción, colas, ejército, batallas,
    territorios, mapa, recompensas y compensación.
-   Comprobar que el cliente no puede manipular datos críticos.
-   Ejecutar pruebas de carga y estabilidad adecuadas al volumen
    esperado.
-   Mantener el entorno anterior disponible durante el periodo de
    validación y solo retirarlo con autorización.

### 8.5. Restricción de medios

La migración y las pruebas no deben depender del ordenador personal del
usuario como servidor ni como máquina obligatoria de pruebas. La
solución debe funcionar en infraestructura remota o gestionada, con un
procedimiento claro de operación y mantenimiento.

## Pruebas de aceptación

-   Datos completos e íntegros en el nuevo entorno.
-   Autenticación y permisos correctos.
-   Sistemas críticos operativos.
-   Copias de seguridad y restauración verificadas.
-   Rendimiento y costes documentados.
-   Reversión posible y probada.
-   Retirada del entorno anterior solo tras autorización expresa.

------------------------------------------------------------------------

# ORDEN DE EJECUCIÓN Y ENTREGAS

  ------------------------------------------------------------------------
                         Orden Punto                 Entrega obligatoria
  ---------------------------- --------------------- ---------------------
                             1 Ejército y espías     Reclutamiento
                                                     especializado,
                                                     límites y pruebas

                             2 Límite territorial    Validaciones y
                                                     saneamiento seguro e
                                                     idempotente

                             3 Mundo y distribución  Mapa de 7.651
                                                     hexágonos y
                                                     generación geográfica
                                                     validada

                             4 Rendimiento e         Optimización medida y
                               interfaz del mapa     mapa mejorado sin
                                                     reducirlo

                             5 Edificios nivel 200   Límites unificados y
                                                     fórmulas históricas
                                                     conservadas

                             6 Compensación          Entrega única de
                                                     30.000 por recurso y
                                                     pruebas de
                                                     concurrencia

                             7 Auditoría gráfica     Documento Markdown
                                                     exhaustivo, sin
                                                     imágenes incorporadas

                             8 Migración             Plan, ejecución y
                                                     validación como
                                                     última fase
  ------------------------------------------------------------------------

## Protocolo de trabajo para cada punto

1.  **Inspección:** leer el código actual y localizar las
    implementaciones reales.
2.  **Diagnóstico:** clasificar cada requisito como correcto,
    incompleto, incorrecto o ausente.
3.  **Plan de cambio:** indicar archivos y funciones afectados, riesgos
    y pruebas necesarias.
4.  **Implementación:** modificar solo lo necesario, preservando lo que
    ya funciona.
5.  **Pruebas:** ejecutar las pruebas pertinentes y añadir cobertura
    para los casos límite.
6.  **Revisión:** buscar regresiones, rutas alternativas, problemas de
    concurrencia y discrepancias entre cliente y servidor.
7.  **Informe:** entregar archivos modificados, resultados reales de
    pruebas y pendientes.
8.  **Publicación:** comprobar que los cambios aparecen en la rama
    acordada y que el commit contiene el trabajo esperado antes de darlo
    por publicado.

## Criterio de cierre del conjunto

El conjunto de actualizaciones solo se considerará terminado cuando los
ocho puntos tengan sus entregables, las pruebas estén ejecutadas y
documentadas, no existan regresiones críticas y la revisión del
repositorio confirme que el código publicado corresponde a la versión
validada.

**La documentación de especificación existente sigue siendo la
referencia del juego.** Este documento concreta las ocho líneas de
actualización acordadas; no la sustituye ni autoriza a reinterpretar o
eliminar reglas anteriores.
