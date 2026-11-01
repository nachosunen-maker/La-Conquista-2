/**
 * LA CONQUISTA — CATÁLOGO HISTÓRICO Y CONFIGURACIÓN DE BOTS MILITARES (Bloques E y F)
 * Adversarios militares preparados para combatir desde el Parlamento.
 * - Sin economía, sin edificios, sin población civil, sin territorios.
 * - 47 monarcas canónicos asignados con dificultad fija inmutable.
 * - 5 bots permanentes (uno por dificultad) y 42 bots rotatorios agrupados en 5 pools.
 * - Rotación global semanal (7 días reales) determinista autoritativa.
 */

import {
  UNITS,
  type ArmorTier,
  type Strategy,
  type TacticalFormation,
  type UnitType,
  type WeaponTier,
} from "./balanceConfig";
import { emptyComposition, type Composition } from "./battleRules";

export type BotDifficulty = "facil" | "media" | "dificil" | "muy_dificil" | "extrema";

export interface BotArmyConfig {
  composition: Composition;
  militaryLevel: number; // 1 a 5
  trainingMultiplier: number; // N1: 1.00, N2: 1.15, N3: 1.35, N4: 1.60, N5: 1.90
  weaponTier: WeaponTier;
  armorTier: ArmorTier;
  morale: number; // 65 a 90
  fatigue: number; // 0 a 10
  strategy: Strategy;
  tacticalFormation: TacticalFormation;
  foodTier: string;
  wallsLevel: number;
}

export interface BotDefinition {
  id: string;
  monarchName: string;
  name: string; // Título o denominación militar
  civilization: string;
  difficulty: BotDifficulty;
  isPermanent: boolean;
  description: string;
  army: BotArmyConfig;
}

export const BOT_DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  facil: "Fácil",
  media: "Media",
  dificil: "Difícil",
  muy_dificil: "Muy difícil",
  extrema: "Extrema",
};

export const BOT_DIFFICULTY_LEVELS: Record<BotDifficulty, { level: number; multiplier: number }> = {
  facil: { level: 1, multiplier: 1.00 },
  media: { level: 2, multiplier: 1.15 },
  dificil: { level: 3, multiplier: 1.35 },
  muy_dificil: { level: 4, multiplier: 1.60 },
  extrema: { level: 5, multiplier: 1.90 },
};

export const BOT_ROTATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días reales

/**
 * Genera la composición militar ajustada según dificultad y especificidades de civilización.
 * Civilizaciones sin caballería (Navajos, Aztecas, Masáis) redistribuyen los efectivos en infantería y arquería.
 */
function makeArmy(
  diff: BotDifficulty,
  civ: string,
  strategy: string = "equilibrada",
  tacticalFormation: TacticalFormation = "equilibrada"
): BotArmyConfig {
  const isNoCavalry = civ === "navajos" || civ === "aztecas" || civ === "masais";
  const isArcheryCiv = civ === "ingleses" || civ === "chinos";
  const isCavalryCiv = civ === "mongoles" || civ === "bizantinos" || civ === "arabes";
  const isInfantryCiv = civ === "romanos" || civ === "griegos" || civ === "vikingos" || civ === "japoneses";

  let inf = 40;
  let arq = 25;
  let cab = 15;
  let ased = 0;
  let weapon: WeaponTier = "palo";
  let armor: ArmorTier = "piel";
  let morale = 65;
  let fatigue = 10;
  let level = 1;
  let training = 1.00;

  switch (diff) {
    case "facil":
      inf = 40; arq = 25; cab = 15; ased = 0;
      weapon = "palo"; armor = "piel";
      morale = 65; fatigue = 10;
      level = 1; training = 1.00;
      break;
    case "media":
      inf = 80; arq = 50; cab = 40; ased = 10;
      weapon = "lanzaBasica"; armor = "cueroReforzado";
      morale = 70; fatigue = 10;
      level = 2; training = 1.15;
      break;
    case "dificil":
      inf = 140; arq = 90; cab = 90; ased = 30;
      weapon = "espadaHierro"; armor = "cueroReforzado";
      morale = 75; fatigue = 5;
      level = 3; training = 1.35;
      break;
    case "muy_dificil":
      inf = 240; arq = 160; cab = 180; ased = 70;
      weapon = "acero"; armor = "hierro";
      morale = 85; fatigue = 5;
      level = 4; training = 1.60;
      break;
    case "extrema":
      inf = 380; arq = 250; cab = 330; ased = 140;
      weapon = "aceroAvanzado"; armor = "acero";
      morale = 90; fatigue = 0;
      level = 5; training = 1.90;
      break;
  }

  // Modulaciones culturales autorizadas
  if (isNoCavalry) {
    const redistributed = cab;
    cab = 0;
    if (civ === "navajos") {
      inf += Math.round(redistributed * 0.4);
      arq += Math.round(redistributed * 0.6);
    } else if (civ === "aztecas") {
      inf += Math.round(redistributed * 0.7);
      arq += Math.round(redistributed * 0.3);
    } else {
      inf += Math.round(redistributed * 0.8);
      arq += Math.round(redistributed * 0.2);
    }
  } else if (isCavalryCiv) {
    const shift = Math.round(inf * 0.25);
    inf -= shift;
    cab += shift;
  } else if (isArcheryCiv) {
    const shift = Math.round(inf * 0.2);
    inf -= shift;
    arq += shift;
  } else if (isInfantryCiv) {
    const shift = Math.round(cab * 0.3);
    cab -= shift;
    inf += shift;
  }

  // Las tres estrategias canónicas aprobadas son defensiva, agresiva y concentracion (P35)
  let actualStrategy: Strategy = "defensiva";
  if (civ === "vikingos" || civ === "aztecas" || civ === "mongoles" || civ === "japoneses") {
    actualStrategy = "agresiva";
  } else if (civ === "arabes" || civ === "navajos" || civ === "masais") {
    actualStrategy = "concentracion";
  } else if (civ === "romanos" || civ === "griegos" || civ === "chinos" || civ === "bizantinos") {
    actualStrategy = "defensiva";
  } else {
    actualStrategy = "concentracion";
  }

  const fullComp = emptyComposition();
  fullComp.infanteria = inf;
  fullComp.arqueria = arq;
  fullComp.caballeria = cab;
  fullComp.asedio = ased;

  return {
    composition: fullComp,
    militaryLevel: level,
    trainingMultiplier: training,
    weaponTier: weapon,
    armorTier: armor,
    morale,
    fatigue,
    strategy: actualStrategy,
    tacticalFormation,
    foodTier: "normal",
    wallsLevel: 0,
  };
}

// =============================================================================
// CATÁLOGO DE LOS 5 BOTS PERMANENTES (1 de cada dificultad)
// =============================================================================
export const PERMANENT_BOTS: ReadonlyArray<BotDefinition> = [
  {
    id: "bot_perm_narbona",
    monarchName: "Narbona",
    name: "Partida Diné de Narbona",
    civilization: "navajos",
    difficulty: "facil",
    isPermanent: true,
    description: "Jefe tradicional navajo de Chuska. Hostigadores ligeros y arqueros de emboscada.",
    army: makeArmy("facil", "navajos", "emboscada", "flanqueo"),
  },
  {
    id: "bot_perm_alfredo",
    monarchName: "Alfredo el Grande",
    name: "Hueste Sajona de Wessex",
    civilization: "ingleses",
    difficulty: "media",
    isPermanent: true,
    description: "Rey de Wessex y defensor de Britania. Formación equilibrada de arqueros y hombres de armas.",
    army: makeArmy("media", "ingleses", "defensiva", "equilibrada"),
  },
  {
    id: "bot_perm_leonidas",
    monarchName: "Leónidas I",
    name: "Guardia Espartana de Leónidas",
    civilization: "griegos",
    difficulty: "dificil",
    isPermanent: true,
    description: "Rey de Esparta. Falange hoplita férrea con escudos hoplon y disciplina inquebrantable.",
    army: makeArmy("dificil", "griegos", "desgaste", "defensiva"),
  },
  {
    id: "bot_perm_saladino",
    monarchName: "Saladino",
    name: "Ejército Ayubí de Saladino",
    civilization: "arabes",
    difficulty: "muy_dificil",
    isPermanent: true,
    description: "Sultán de Egipto y Siria. Caballería ligera veloz, arqueros a caballo y maniobras envolventes.",
    army: makeArmy("muy_dificil", "arabes", "envolvente", "ofensiva"),
  },
  {
    id: "bot_perm_julio_cesar",
    monarchName: "Julio César",
    name: "Legiones Consulares de César",
    civilization: "romanos",
    difficulty: "extrema",
    isPermanent: true,
    description: "Dictador de Roma. Legiones veteranas de asalto con maquinaria pesada y disciplina magistral.",
    army: makeArmy("extrema", "romanos", "ofensiva", "ofensiva"),
  },
];

// =============================================================================
// CATÁLOGO DE LOS 42 BOTS ROTATORIOS (distribuidos en 5 pools fijos)
// =============================================================================

export const ROTATING_POOLS: Readonly<Record<BotDifficulty, ReadonlyArray<BotDefinition>>> = {
  facil: [
    {
      id: "bot_rot_harald_diente_azul",
      monarchName: "Harald Diente Azul",
      name: "Partida Costera de Harald",
      civilization: "vikingos",
      difficulty: "facil",
      isPermanent: false,
      description: "Rey unificador de Dinamarca y Noruega. Incursión temprana de hachas e infantería.",
      army: makeArmy("facil", "vikingos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_taizu_song",
      monarchName: "Taizu de Song",
      name: "Guardia Inicial de Song",
      civilization: "chinos",
      difficulty: "facil",
      isPermanent: false,
      description: "Fundador de la dinastía Song. Lanceros y tiradores disciplinados.",
      army: makeArmy("facil", "chinos", "defensiva", "equilibrada"),
    },
    {
      id: "bot_rot_minamoto",
      monarchName: "Minamoto no Yoritomo",
      name: "Destacamento de Kamakura",
      civilization: "japoneses",
      difficulty: "facil",
      isPermanent: false,
      description: "Primer shōgun de Kamakura. Guerreros con arco y katana tradicional.",
      army: makeArmy("facil", "japoneses", "desgaste", "equilibrada"),
    },
    {
      id: "bot_rot_ganado_mucho",
      monarchName: "Ganado Mucho",
      name: "Cazadores Diné de Ganado Mucho",
      civilization: "navajos",
      difficulty: "facil",
      isPermanent: false,
      description: "Líder de paz navajo de los valles del oeste. Hostigadores veloces en terreno quebrado.",
      army: makeArmy("facil", "navajos", "emboscada", "flanqueo"),
    },
    {
      id: "bot_rot_acamapichtli",
      monarchName: "Acamapichtli",
      name: "Milicia Lacustre de Tenochtitlan",
      civilization: "aztecas",
      difficulty: "facil",
      isPermanent: false,
      description: "Primer tlatoani de Tenochtitlan. Lanceros tepoztopilli y tiradores atlatl.",
      army: makeArmy("facil", "aztecas", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_mbatian",
      monarchName: "Mbatian",
      name: "Partida Sagrada de Mbatian",
      civilization: "masais",
      difficulty: "facil",
      isPermanent: false,
      description: "Gran Oloiboni masái. Guerreros jóvenes armados con lanza rungu y escudo tradicional.",
      army: makeArmy("facil", "masais", "defensiva", "equilibrada"),
    },
    {
      id: "bot_rot_augusto",
      monarchName: "Augusto",
      name: "Cohortes Pretorianas de Augusto",
      civilization: "romanos",
      difficulty: "facil",
      isPermanent: false,
      description: "Primer emperador de Roma. Guardia de orden imperial y formación defensiva.",
      army: makeArmy("facil", "romanos", "defensiva", "defensiva"),
    },
    {
      id: "bot_rot_alejo_comneno",
      monarchName: "Alejo I Comneno",
      name: "Tagmata de Constantinopla",
      civilization: "bizantinos",
      difficulty: "facil",
      isPermanent: false,
      description: "Emperador restaurador bizantino. Infantería scutati con apoyo de arqueros toxotes.",
      army: makeArmy("facil", "bizantinos", "desgaste", "defensiva"),
    },
  ],

  media: [
    {
      id: "bot_rot_canuto",
      monarchName: "Canuto el Grande",
      name: "Hueste del Mar del Norte",
      civilization: "vikingos",
      difficulty: "media",
      isPermanent: false,
      description: "Rey de Dinamarca, Inglaterra y Noruega. Guerreros de élite con escudo y armadura de cuero.",
      army: makeArmy("media", "vikingos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_taizong_tang",
      monarchName: "Taizong de Tang",
      name: "Regimiento de Élite Tang",
      civilization: "chinos",
      difficulty: "media",
      isPermanent: false,
      description: "Segundo emperador de la dinastía Tang. Ballesteros y jinetes coordinados.",
      army: makeArmy("media", "chinos", "defensiva", "equilibrada"),
    },
    {
      id: "bot_rot_ashikaga",
      monarchName: "Ashikaga Yoshimitsu",
      name: "Hueste del Shogunato Muromachi",
      civilization: "japoneses",
      difficulty: "media",
      isPermanent: false,
      description: "Tercer shōgun Ashikaga. Samuráis a caballo y arqueros ashigaru.",
      army: makeArmy("media", "japoneses", "desgaste", "equilibrada"),
    },
    {
      id: "bot_rot_barboncito",
      monarchName: "Barboncito",
      name: "Guerrilleros Diné de Cañón de Chelly",
      civilization: "navajos",
      difficulty: "media",
      isPermanent: false,
      description: "Estratega navajo de la resistencia en el cañón. Tácticas de desgaste y emboscada rápida.",
      army: makeArmy("media", "navajos", "emboscada", "flanqueo"),
    },
    {
      id: "bot_rot_itzcoatl",
      monarchName: "Itzcóatl",
      name: "Ejército de la Triple Alianza",
      civilization: "aztecas",
      difficulty: "media",
      isPermanent: false,
      description: "Fundador del Imperio Mexica. Guerreros con macuahuitl y disciplina ritual.",
      army: makeArmy("media", "aztecas", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_senteu",
      monarchName: "Senteu",
      name: "Guerreros Il-Moran de Senteu",
      civilization: "masais",
      difficulty: "media",
      isPermanent: false,
      description: "Líder de los Moran de la sabana. Tropas de asalto ágiles y resistentes a la fatiga.",
      army: makeArmy("media", "masais", "ofensiva", "flanqueo"),
    },
    {
      id: "bot_rot_trajano",
      monarchName: "Trajano",
      name: "Legiones Dacias de Trajano",
      civilization: "romanos",
      difficulty: "media",
      isPermanent: false,
      description: "Emperador de la máxima expansión. Formaciones cerradas de infantería pesada y balistas.",
      army: makeArmy("media", "romanos", "desgaste", "defensiva"),
    },
    {
      id: "bot_rot_justiniano",
      monarchName: "Justiniano I",
      name: "Hueste Oriental de Justiniano",
      civilization: "bizantinos",
      difficulty: "media",
      isPermanent: false,
      description: "Emperador de la reconquista mediterránea. Catafractos acorazados e infantería pesada.",
      army: makeArmy("media", "bizantinos", "desgaste", "equilibrada"),
    },
    {
      id: "bot_rot_harun_rashid",
      monarchName: "Harún al-Rashid",
      name: "Guardia Abasí de Bagdad",
      civilization: "arabes",
      difficulty: "media",
      isPermanent: false,
      description: "Califa de las Mil y Una Noches. Caballería rápida con cota de malla y arquería montada.",
      army: makeArmy("media", "arabes", "envolvente", "ofensiva"),
    },
  ],

  dificil: [
    {
      id: "bot_rot_guillermo",
      monarchName: "Guillermo el Conquistador",
      name: "Ejército Normando de Guillermo",
      civilization: "ingleses",
      difficulty: "dificil",
      isPermanent: false,
      description: "Duque de Normandía y rey de Inglaterra. Cargas de caballería pesada y arqueros tácticos.",
      army: makeArmy("dificil", "ingleses", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_filipo_ii",
      monarchName: "Filipo II",
      name: "Falange Sarisa de Macedonia",
      civilization: "griegos",
      difficulty: "dificil",
      isPermanent: false,
      description: "Rey de Macedonia y padre de Alejandro. Falangistas con sarisas largas de 6 metros.",
      army: makeArmy("dificil", "griegos", "desgaste", "defensiva"),
    },
    {
      id: "bot_rot_harald_hardrada",
      monarchName: "Harald Hardrada",
      name: "Hueste Berserker de Hardrada",
      civilization: "vikingos",
      difficulty: "dificil",
      isPermanent: false,
      description: "Último gran rey vikingo. Guardia varega veterana con hachas danesas de hierro.",
      army: makeArmy("dificil", "vikingos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_niceforo_focas",
      monarchName: "Nicéforo II Focas",
      name: "Fuerza de Choque de Focas",
      civilization: "bizantinos",
      difficulty: "dificil",
      isPermanent: false,
      description: "El 'Azote de los Sarracenos'. Maniobras acorazadas de catafractos y armas de asedio.",
      army: makeArmy("dificil", "bizantinos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_abd_al_malik",
      monarchName: "Abd al-Malik",
      name: "Cuerpo Omeya de Damasco",
      civilization: "arabes",
      difficulty: "dificil",
      isPermanent: false,
      description: "Califa omeya organizador de los ejércitos árabes. Jinetes del desierto y arqueros de élite.",
      army: makeArmy("dificil", "arabes", "envolvente", "flanqueo"),
    },
    {
      id: "bot_rot_ogedei",
      monarchName: "Ögedei Kan",
      name: "Tumén Imperial de Ögedei",
      civilization: "mongoles",
      difficulty: "dificil",
      isPermanent: false,
      description: "Segundo Gran Kan del Imperio Mongol. Disparos continuos a caballo y asedio balístico.",
      army: makeArmy("dificil", "mongoles", "envolvente", "flanqueo"),
    },
    {
      id: "bot_rot_wu_han",
      monarchName: "Wu de Han",
      name: "Ejército del Norte de Han",
      civilization: "chinos",
      difficulty: "dificil",
      isPermanent: false,
      description: "Emperador guerrero de la dinastía Han. Ballestas pesadas y corazas lameladas.",
      army: makeArmy("dificil", "chinos", "defensiva", "equilibrada"),
    },
    {
      id: "bot_rot_manuelito",
      monarchName: "Manuelito",
      name: "Regimiento Defensor de Manuelito",
      civilization: "navajos",
      difficulty: "dificil",
      isPermanent: false,
      description: "Gran jefe militar navajo. Tácticas de guerrilla letales en desfiladeros rocosos.",
      army: makeArmy("dificil", "navajos", "emboscada", "flanqueo"),
    },
    {
      id: "bot_rot_lenana",
      monarchName: "Lenana",
      name: "Guardia Territorial de Lenana",
      civilization: "masais",
      difficulty: "dificil",
      isPermanent: false,
      description: "Poderoso Oloiboni supremo. Vanguardia de guerreros Il-Moran con lanzas templadas.",
      army: makeArmy("dificil", "masais", "ofensiva", "ofensiva"),
    },
  ],

  muy_dificil: [
    {
      id: "bot_rot_ricardo_corazon_leon",
      monarchName: "Ricardo Corazón de León",
      name: "Hueste Cruzada de Ricardo",
      civilization: "ingleses",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Líder de la Tercera Cruzada. Caballeros acorazados de carga frontal y arqueros de élite.",
      army: makeArmy("muy_dificil", "ingleses", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_aureliano",
      monarchName: "Aureliano",
      name: "Legiones Restauradoras de Aureliano",
      civilization: "romanos",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Restaurador del Mundo ('Restitutor Orbis'). Disciplina de hierro y máquinas de asedio.",
      army: makeArmy("muy_dificil", "romanos", "ofensiva", "defensiva"),
    },
    {
      id: "bot_rot_pirro",
      monarchName: "Pirro de Epiro",
      name: "Hueste Veterana de Pirro",
      civilization: "griegos",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Rey de Epiro y maestro táctico. Falange macedonia pesada y maniobras audaces.",
      army: makeArmy("muy_dificil", "griegos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_ragnar",
      monarchName: "Ragnar Lodbrok",
      name: "Gran Ejército Pagano de Ragnar",
      civilization: "vikingos",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Caudillo legendario nórdico. Asalto implacable de guerreros vikingos con hachas de acero.",
      army: makeArmy("muy_dificil", "vikingos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_basilio_ii",
      monarchName: "Basilio II",
      name: "Ejército Búlgaroctono de Basilio",
      civilization: "bizantinos",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Emperador triunfal de Bizancio. Guardia varega y catafractos pesados de acero.",
      army: makeArmy("muy_dificil", "bizantinos", "desgaste", "defensiva"),
    },
    {
      id: "bot_rot_baybars",
      monarchName: "Baybars",
      name: "Ejército Mameluco de Baybars",
      civilization: "arabes",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Sultán mameluco vencedor de mongoles y cruzados. Cargas arrolladoras de caballería de acero.",
      army: makeArmy("muy_dificil", "arabes", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_batu_kan",
      monarchName: "Batu Kan",
      name: "Horda de Oro de Batu",
      civilization: "mongoles",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Fundador de la Horda de Oro y conquistador de Europa oriental. Lluvia de flechas y cerco letal.",
      army: makeArmy("muy_dificil", "mongoles", "envolvente", "flanqueo"),
    },
    {
      id: "bot_rot_ahuitzotl",
      monarchName: "Ahuítzotl",
      name: "Ejército Conquistador Mexica",
      civilization: "aztecas",
      difficulty: "muy_dificil",
      isPermanent: false,
      description: "Tlatoani conquistador de Mesoamérica. Élite de guerreros Jaguar y Águila con macuahuitl.",
      army: makeArmy("muy_dificil", "aztecas", "ofensiva", "ofensiva"),
    },
  ],

  extrema: [
    {
      id: "bot_rot_enrique_v",
      monarchName: "Enrique V",
      name: "Hueste Real de Azincourt",
      civilization: "ingleses",
      difficulty: "extrema",
      isPermanent: false,
      description: "Vencedor de Azincourt. Lluvia masiva de arcos largos y caballería pesada de placas de acero.",
      army: makeArmy("extrema", "ingleses", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_alejandro_magno",
      monarchName: "Alejandro Magno",
      name: "Ejército Conquistador de Alejandro",
      civilization: "griegos",
      difficulty: "extrema",
      isPermanent: false,
      description: "Invicto conquistador de Asia. Falange sarisa imperial, caballería de compañeros y asedio colosal.",
      army: makeArmy("extrema", "griegos", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_gengis_kan",
      monarchName: "Gengis Kan",
      name: "Gran Tumén de Gengis Kan",
      civilization: "mongoles",
      difficulty: "extrema",
      isPermanent: false,
      description: "Fundador del mayor imperio contiguo. Maniobras de cerco perfectas, arcos compuestos de élite y asedio.",
      army: makeArmy("extrema", "mongoles", "envolvente", "flanqueo"),
    },
    {
      id: "bot_rot_kublai_kan",
      monarchName: "Kublai Kan",
      name: "Ejército Imperial Yuan",
      civilization: "mongoles",
      difficulty: "extrema",
      isPermanent: false,
      description: "Emperador de la dinastía Yuan. Hueste masiva combinada de caballería de estepa y catapultas gigantes.",
      army: makeArmy("extrema", "mongoles", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_qin_shi_huang",
      monarchName: "Qin Shi Huang",
      name: "Ejército del Primer Emperador Qin",
      civilization: "chinos",
      difficulty: "extrema",
      isPermanent: false,
      description: "Primer emperador de China unificada. Miles de ballesteros de repetición y lanceros acorazados.",
      army: makeArmy("extrema", "chinos", "defensiva", "defensiva"),
    },
    {
      id: "bot_rot_oda_nobunaga",
      monarchName: "Oda Nobunaga",
      name: "Hueste Revolucionaria de Nobunaga",
      civilization: "japoneses",
      difficulty: "extrema",
      isPermanent: false,
      description: "Gran unificador de Japón. Disciplina marcial samurái, formación cerrada y proyectiles masivos.",
      army: makeArmy("extrema", "japoneses", "ofensiva", "ofensiva"),
    },
    {
      id: "bot_rot_toyotomi",
      monarchName: "Toyotomi Hideyoshi",
      name: "Gran Ejército Imperial de Hideyoshi",
      civilization: "japoneses",
      difficulty: "extrema",
      isPermanent: false,
      description: "Segundo unificador de Japón. Samuráis veteranos con armadura gusoku de acero y armas de fuego iniciales.",
      army: makeArmy("extrema", "japoneses", "desgaste", "ofensiva"),
    },
    {
      id: "bot_rot_moctezuma_ii",
      monarchName: "Moctezuma Xocoyotzin",
      name: "Guardia Imperial de Moctezuma",
      civilization: "aztecas",
      difficulty: "extrema",
      isPermanent: false,
      description: "Soberano supremo del Imperio Azteca. Miles de guerreros Jaguar y Águila consagrados al combate.",
      army: makeArmy("extrema", "aztecas", "ofensiva", "ofensiva"),
    },
  ],
};

/**
 * Calcula el índice determinista del ciclo semanal global.
 * Garantiza que todos los jugadores vean exactamente los mismos bots rotatorios
 * durante los mismos 7 días reales (604.800.000 ms).
 */
export function getRotationCycle(serverNowMs: number): {
  cycleIndex: number;
  cycleStartMs: number;
  cycleExpiresAtMs: number;
} {
  const cycleIndex = Math.floor(serverNowMs / BOT_ROTATION_INTERVAL_MS);
  const cycleStartMs = cycleIndex * BOT_ROTATION_INTERVAL_MS;
  const cycleExpiresAtMs = cycleStartMs + BOT_ROTATION_INTERVAL_MS;
  return { cycleIndex, cycleStartMs, cycleExpiresAtMs };
}

/**
 * Obtiene los 5 bots rotatorios correspondientes al ciclo semanal actual (1 por dificultad).
 */
export function getRotatingBots(serverNowMs: number): BotDefinition[] {
  const { cycleIndex } = getRotationCycle(serverNowMs);
  const difficulties: BotDifficulty[] = ["facil", "media", "dificil", "muy_dificil", "extrema"];

  return difficulties.map((diff) => {
    const pool = ROTATING_POOLS[diff];
    const botIndex = cycleIndex % pool.length;
    return pool[botIndex];
  });
}

/**
 * Devuelve todos los bots actualmente activos para un timestamp del servidor:
 * 5 permanentes + 5 rotatorios = 10 bots militares listos para el Parlamento.
 */
export function getAllActiveBots(serverNowMs: number): BotDefinition[] {
  const permanent = [...PERMANENT_BOTS];
  const rotating = getRotatingBots(serverNowMs);
  return [...permanent, ...rotating];
}

/**
 * Busca un bot por su identificador único dentro de todos los monarcas conocidos.
 */
export function getBotById(botId: string): BotDefinition | null {
  const perm = PERMANENT_BOTS.find((b) => b.id === botId);
  if (perm) return perm;

  for (const pool of Object.values(ROTATING_POOLS)) {
    const found = pool.find((b) => b.id === botId);
    if (found) return found;
  }
  return null;
}
