/**
 * LA CONQUISTA — ETAPA 1D-18: TIPOS LOCALES AISLADOS
 * Modelado TypeScript plano e independiente basado EXCLUSIVAMENTE en los
 * documentos observados de forma empírica en el despliegue remoto 'festive-dodo-429'.
 * REGLAS METODOLÓGICAS:
 * 1. Campos y tipos derivados directamente de documentos observados en el reino real ('guest_g9ai8cz').
 * 2. No se inventan campos, índices, valores por defecto, relaciones de unicidad ni reglas de integridad.
 * 3. Se utiliza 'string' para 'jobType', 'unitType' y 'buildingType'; los valores observados se documentan
 *    como ejemplos empíricos, sin declararse como listas exhaustivas o enums cerrados.
 * 4. La colección 'messages' se mantiene segregada: su contrato de entrada procede de un validador
 *    de mutación confirmado, pero no se ha observado ningún documento persistido directamente.
 * 5. Este archivo no interactúa con Convex, no define 'schema.ts' ni interfiere con los módulos existentes.
 */

/**
 * Tabla: "kingdoms"
 * Documento raíz del reino observado empíricamente en la base de datos.
 */
export interface ObservedKingdomDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Identificador del usuario propietario (p. ej. 'guest_g9ai8cz') */
  userId: string;
  /** Nombre del reino (p. ej. 'Reino de Iberia') */
  name: string;
  /** Nombre del castillo (p. ej. 'Castillo de Zaragoza') */
  castleName: string;
  /** Nombre del monarca (p. ej. 'Rey Arturo') */
  monarchName: string;
  /** Civilización seleccionada (p. ej. 'Ingleses') */
  civilization: string;
  /** Política fiscal aplicada (p. ej. 'normales') */
  taxPolicy: string;
  /** Nivel de felicidad civil observado (p. ej. 85) */
  happiness: number;
  /** Moral militar observada (p. ej. 80) */
  militaryMorale: number;
  /** Marca de tiempo de creación en milisegundos */
  createdAt: number;
  /** Marca de tiempo de última actualización en milisegundos */
  updatedAt: number;
}

/**
 * Tabla: "resources"
 * Recursos económicos asociados al reino.
 */
export interface ObservedResourcesDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Referencia foránea al reino (_id de "kingdoms") */
  kingdomId: string;
  /** Reserva de oro */
  gold: number;
  /** Reserva de alimentos (raciones) */
  food: number;
  /** Reserva de madera */
  wood: number;
  /** Reserva de piedra */
  stone: number;
  /** Reserva de hierro */
  iron: number;
  /** Marca de tiempo del último cálculo o actualización en milisegundos */
  lastUpdated: number;
}

/**
 * Tabla: "population"
 * Estado demográfico general del reino.
 */
export interface ObservedPopulationDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Referencia foránea al reino (_id de "kingdoms") */
  kingdomId: string;
  /** Censo poblacional total (p. ej. 1000) */
  total: number;
  /** Población disponible / desocupada (p. ej. 0) */
  available: number;
  /** Capacidad habitacional máxima (p. ej. 1500) */
  capacity: number;
  /** Indicador booleano de hambruna activa */
  starving: boolean;
}

/**
 * Tabla: "populationJobs"
 * Asignación laboral por oficio. En el backend remoto cada oficio se almacena
 * como un documento individual en la colección 'populationJobs'.
 * Valores observados empíricamente en 'jobType' (ejemplos no exhaustivos):
 * - 'agriculture'
 * - 'mining'
 * - 'construction'
 * - 'military'
 * - 'scholars'
 */
export interface ObservedPopulationJobDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Referencia foránea al reino (_id de "kingdoms") */
  kingdomId: string;
  /**
   * Tipo de oficio. Se define como string amplio para no asumir una lista cerrada.
   * Valores observados de ejemplo: 'agriculture', 'mining', 'construction', 'military', 'scholars'.
   */
  jobType: string;
  /** Cantidad de habitantes asignados a este oficio */
  assignedCount: number;
}

/**
 * Tabla: "Armyunits"
 * Unidades militares del reino. En el backend remoto cada tipo de unidad
 * se almacena como un documento individual en la colección 'Armyunits'.
 * Valores observados empíricamente en 'unitType' (ejemplos no exhaustivos):
 * - 'infanteria'
 * - 'arqueria'
 * - 'caballeria'
 * - 'asedio'
 */
export interface ObservedArmyUnitDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Referencia foránea al reino (_id de "kingdoms") */
  kingdomId: string;
  /**
   * Tipo de unidad militar. Se define como string amplio para no asumir una lista cerrada.
   * Valores observados de ejemplo: 'infanteria', 'arqueria', 'caballeria', 'asedio'.
   */
  unitType: string;
  /** Cantidad de tropas vivas de esta unidad */
  count: number;
}

/**
 * Tabla: "buildings"
 * Edificios del reino. En el backend remoto cada edificio se almacena
 * como un documento individual en la colección 'buildings'.
 * Valores observados empíricamente en 'buildingType' (ejemplos no exhaustivos):
 * - 'granja'
 * - 'aserradero'
 * - 'cantera'
 * - 'minaHierro'
 * - 'viviendas'
 * - 'murallas'
 * - 'cuartel'
 * - 'universidad'
 * - 'parlamento'
 * - 'mercado'
 */
export interface ObservedBuildingDoc {
  /** Identificador de documento en Convex */
  _id: string;
  /** Marca de tiempo de creación gestionada por el runtime */
  _creationTime: number;
  /** Referencia foránea al reino (_id de "kingdoms") */
  kingdomId: string;
  /**
   * Tipo de edificio. Se define como string amplio para no asumir una lista cerrada.
   * Valores observados de ejemplo: 'granja', 'aserradero', 'cantera', 'minaHierro',
   * 'viviendas', 'murallas', 'cuartel', 'universidad', 'parlamento', 'mercado'.
   */
  buildingType: string;
  /** Nivel actual del edificio */
  level: number;
}

/**
 * Colección: "messages"
 * ESTATUS: SEGREGADO / NO CONFIRMADO EN PERSISTENCIA.
 * Este tipo refleja EXCLUSIVAMENTE los argumentos exigidos por el validador de la
 * mutación remota 'messages:sendMessage', verificado en la etapa 1D-14.
 * La consulta de lectura devolvió un array vacío '[]', por lo que ningún documento
 * persistido ha sido observado directamente en la base de datos.
 */
export interface ObservedMessageInputContract {
  /** Canal de destino del mensaje (p. ej. 'general') */
  channel: string;
  /** Contenido textual del mensaje */
  content: string;
  /** Nombre del reino del remitente */
  kingdomName: string;
  /** Identificador de usuario del remitente */
  senderUserId: string;
  /** Identificador opcional de usuario destinatario (para mensajes directos) */
  receiverUserId?: string;
}
