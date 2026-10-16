/**
 * LA CONQUISTA — ETAPA 1D-21: INTERFACES LOCALES PROVISIONALES DE ENTIDADES SECUNDARIAS
 * Definición de interfaces TypeScript PROVISIONALES para las cinco colecciones secundarias
 * cuya existencia o interacción ha sido confirmada en el backend remoto 'festive-dodo-429',
 * pero cuyos documentos poblados NO se han podido observar directamente.
 * REGLAS METODOLÓGICAS:
 * 1. Separación estricta entre campos respaldados por evidencia empírica (validadores / queries)
 *    y campos pendientes de definición formal.
 * 2. Ningún campo desconocido se declara como confirmado ni definitivo.
 * 3. No se inventan coordenadas, bonificaciones, fórmulas, duraciones, estados ni costes.
 * 4. Las entidades se mantienen deliberadamente mínimas para evitar acoplamientos espurios.
 * 5. Se conservan los nombres exactos confirmados, incluyendo las mayúsculas de 'Battle'.
 * 6. Este archivo es puramente local; no es importado por 'convex/' ni interactúa con el backend.
 */

// ============================================================================
// 1. constructionQueue
// ============================================================================
/**
 * Interfaz provisional para elementos de la cola de construcción.
 * EVIDENCIA CONFIRMADA:
 * - Tipo de ID en Convex verificado en validadores: v.id("constructionQueue")
 *   (requerido por 'buildings:completeConstruction' y 'buildings:cancelConstruction').
 * - Clave 'constructionQueue' presente en la respuesta de 'kingdoms:getKingdomFull'.
 * CAMPOS PENDIENTES DE DEFINICIÓN FORMAL:
 * - Nombres exactos de las marcas de tiempo (inicio, duración, finalización).
 * - Identificación del objetivo (si referencia a 'buildingType: string' y 'targetLevel: number').
 * - Registro de recursos invertidos o política de reembolso en cancelación.
 */
export interface ProposedConstructionQueueItem {
  /** [CONFIRMADO]: Identificador de documento en la colección 'constructionQueue' */
  _id: string;
  /** [CONFIRMADO]: Timestamp de creación en Convex */
  _creationTime: number;
  /** [CONFIRMADO]: Referencia al reino propietario (_id de 'kingdoms') */
  kingdomId: string;
  /**
   * [PROPUESTO MÍNIMO]: Tipo de edificio en construcción.
   * Derivado del argumento 'buildingType' en 'buildings:upgradeBuilding'.
   */
  buildingType?: string;
  /**
   * [PROPUESTO MÍNIMO]: Nivel objetivo del edificio.
   */
  targetLevel?: number;
  /**
   * [PENDIENTE DE DEFINICIÓN]:
   * Marcas de tiempo de progreso (p. ej., timestamp de finalización o inicio).
   * La estructura remota exacta continúa sin documentar; no se infieren nombres de campo.
   */
}

// ============================================================================
// 2. technologies
// ============================================================================
/**
 * Interfaz provisional para registros de tecnologías e investigaciones.
 * EVIDENCIA CONFIRMADA:
 * - Query pública 'technologies:getTechnologies' exige { kingdomId: v.id("kingdoms") } y devuelve array.
 * - Mutación 'technologies:researchTechnology' exige { kingdomId: v.id("kingdoms"), techType: v.string() }.
 * - Clave 'technologies' presente en la respuesta de 'kingdoms:getKingdomFull'.
 * CAMPOS PENDIENTES DE DEFINICIÓN FORMAL:
 * - Modelo de almacenamiento: se desconoce si persiste un documento por tecnología adquirida
 *   o un documento único por reino con un árbol de flags booleanos o niveles numéricos.
 * - Registro de fecha de investigación o nivel tecnológico alcanzado.
 */
export interface ProposedTechnologyDoc {
  /** [CONFIRMADO]: Identificador de documento en la colección 'technologies' */
  _id: string;
  /** [CONFIRMADO]: Timestamp de creación en Convex */
  _creationTime: number;
  /** [CONFIRMADO]: Referencia al reino investigador (_id de 'kingdoms') */
  kingdomId: string;
  /**
   * [PROPUESTO MÍNIMO]: Identificador o tipo de la tecnología.
   * Derivado del argumento 'techType' verificado en 'technologies:researchTechnology'.
   */
  techType?: string;
  /**
   * [PENDIENTE DE DEFINICIÓN]:
   * Nivel tecnológico o marca de tiempo de adquisición.
   * Estructura interna pendiente de documentación formal.
   */
}

// ============================================================================
// 3. territories
// ============================================================================
/**
 * Interfaz provisional para provincias o parcelas del mapa territorial.
 * EVIDENCIA CONFIRMADA:
 * - Query pública 'territories:getTerritories' validada: v.object({}) (no acepta argumentos).
 * - La consulta remota devuelve un array de territorios (observado vacío en el despliegue).
 * CAMPOS PENDIENTES DE DEFINICIÓN FORMAL:
 * - Sistema de coordenadas cartesianas o hexagonales (X, Y).
 * - Identificador de provincia, nombre o región.
 * - Tipo de terreno y modificadores económicos o defensivos.
 * - Asignación de soberanía ('ownerKingdomId') o estado de disputa territorial.
 */
export interface ProposedTerritoryDoc {
  /** [CONFIRMADO]: Identificador de documento en la colección 'territories' */
  _id: string;
  /** [CONFIRMADO]: Timestamp de creación en Convex */
  _creationTime: number;
  /**
   * [PENDIENTE DE DEFINICIÓN]:
   * Coordenadas geográficas, tipo de territorio, bonificaciones y propietario.
   * Ningún documento poblado ha sido observado y la Especificación Maestra no fija
   * la estructura de datos cartográfica. Se mantiene deliberadamente mínima.
   */
  ownerKingdomId?: string;
}

// ============================================================================
// 4. Battle
// ============================================================================
/**
 * Interfaz provisional para el historial o informe de combate militar.
 * EVIDENCIA CONFIRMADA:
 * - Nombre de tabla exacto: 'Battle' (con 'B' mayúscula, confirmado en el despliegue).
 * - Query pública 'battles:getBattles' exige { kingdomId: v.id("kingdoms") } y devuelve array.
 * CAMPOS PENDIENTES DE DEFINICIÓN FORMAL:
 * - Identificación de contendientes (atacante y defensor).
 * - Desglose de bajas por tipo de tropa y rondas tácticas de combate.
 * - Resultado de la contienda (victoria, derrota, empate).
 * - Cuantía del botín saqueado (recursos transferidos).
 * - Timestamp exacto de resolución.
 */
export interface ProposedBattleDoc {
  /** [CONFIRMADO]: Identificador de documento en la colección 'Battle' */
  _id: string;
  /** [CONFIRMADO]: Timestamp de creación en Convex */
  _creationTime: number;
  /** [CONFIRMADO]: Referencia al reino consultado (_id de 'kingdoms') */
  kingdomId: string;
  /**
   * [PENDIENTE DE DEFINICIÓN]:
   * Estructura detallada del reporte táctico de batalla (contingentes enfrentados,
   * bajas por unidad, informe de rondas y botín de recursos).
   * La Especificación Maestra describe el flujo de combate pero el esquema documental
   * permanece pendiente de cierre formal.
   */
}

// ============================================================================
// 5. challenges
// ============================================================================
/**
 * Interfaz provisional para la máquina de estados parlamentaria de retos PvP.
 * EVIDENCIA CONFIRMADA:
 * - Mutación 'challenges:createChallenge' con validador verificado:
 *   v.object({
 *     challengeType: v.string(),
 *     challengerKingdomId: v.id("kingdoms"),
 *     targetKingdomId: v.id("kingdoms")
 *   })
 * CAMPOS PENDIENTES DE DEFINICIÓN FORMAL:
 * - Estado de la máquina parlamentaria: máquina disjunta (según BLOQUE_9.txt:
 *   'pending', 'accepted', 'rejected', 'frozen', 'resolved').
 * - Ventana temporal de programación seleccionada (de las 3 opciones de P37-P38).
 * - Plazo límite de respuesta (deadline / timeout).
 * - Penalización o retención de recursos (escrow / apuestas de P38).
 * - Contingente militar comprometido antes del congelamiento (P40).
 */
export interface ProposedChallengeDoc {
  /** [CONFIRMADO]: Identificador de documento en la colección 'challenges' */
  _id: string;
  /** [CONFIRMADO]: Timestamp de creación en Convex */
  _creationTime: number;
  /**
   * [CONFIRMADO EN VALIDADOR]: Tipo de desafío parlamentario.
   */
  challengeType: string;
  /**
   * [CONFIRMADO EN VALIDADOR]: Reino desafiante emisor (_id de 'kingdoms').
   */
  challengerKingdomId: string;
  /**
   * [CONFIRMADO EN VALIDADOR]: Reino objetivo receptor (_id de 'kingdoms').
   */
  targetKingdomId: string;
  /**
   * [PENDIENTE DE DEFINICIÓN]:
   * Máquina de estados parlamentaria ('status'), plazos temporales, retención de recursos
   * y contingente militar comprometido. Los valores numéricos y plazos permanecen
   * pendientes de balance según BLOQUE_9.txt.
   */
  status?: string;
}
