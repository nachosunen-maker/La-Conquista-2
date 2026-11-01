import React, { useState, useMemo } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Landmark, Swords, Scroll, Eye, Coins, Award, Trophy } from 'lucide-react';
import { isTestOrDemoKingdom } from '../../convex/explorationRules';
import {
  PanelSection,
  StatusMessages,
  UNIT_LABELS,
  cardClass,
  dangerButton,
  formatCosts,
  formatDateTime,
  formatSecondsDuration,
  inputClass,
  primaryButton,
  readOnlyNote,
  selectClass,
  useActionState,
  useServerClock,
} from './shared';

const getParliamentQuery = makeFunctionReference<"query">("parliament:getParliament");
const listRivalsQuery = makeFunctionReference<"query">("parliament:listRivals");
const getWorldMapQuery = makeFunctionReference<"query">("territories:getWorldMap");
const getBattlesQuery = makeFunctionReference<"query">("parliament:getBattles");
const getLeaderboardQuery = makeFunctionReference<"query">("parliament:getLeaderboard");
const createChallengeMutation = makeFunctionReference<"mutation">("parliament:createChallenge");
const acceptChallengeMutation = makeFunctionReference<"mutation">("parliament:acceptChallenge");
const rejectChallengeMutation = makeFunctionReference<"mutation">("parliament:rejectChallenge");
const sendPredefinedMessageMutation = makeFunctionReference<"mutation">("parliament:sendPredefinedMessage");
const requestEspionageReportMutation = makeFunctionReference<"mutation">("parliament:requestEspionageReport");
const claimDailyBonusMutation = makeFunctionReference<"mutation">("kingdoms:claimDailyBonus");
const setTaxRateMutation = makeFunctionReference<"mutation">("economy:setTaxRate");

interface ParliamentState {
  serverTimeMs: number;
  writable: boolean;
  parliamentLevel: number;
  requiredParliamentLevel: number;
  badgeCount: number;
  windows: Record<string, number>;
  predefinedMessages: ReadonlyArray<{ id: string; text: string }>;
  honor: number;
  glory: number;
  pendingTerritoryClaims: number;
  challenges: Array<{
    _id: string;
    direction: 'incoming' | 'outgoing';
    rivalKingdomId: string;
    rivalName: string;
    challengeType: string;
    status: string;
    createdAt: number;
    expiresAt: number;
    window: string | null;
    scheduledAt: number | null;
    freezeAt: number | null;
    resolvedAt: number | null;
    battleId: string | null;
    distance: number | null;
    marchSeconds: number | null;
    messages: Array<{ fromKingdomId: string; messageId: string; at: number; text: string }>;
  }>;
}

interface RivalsState {
  serverTimeMs: number;
  rivals: Array<{
    kingdomId: string;
    name: string;
    civilization: string | null;
    parliamentLevel: number;
    canBeChallenged: boolean;
    approximatePopulation: number;
    armyEstimate: { min: number; max: number; error: number };
    honor: number;
    distance: number | null;
    espionageReport: { level: number; expiresAt: number; composition: Record<string, { min: number; max: number }> | null } | null;
  }>;
}

interface LeaderboardState {
  serverTimeMs: number;
  rankings: Array<{
    rank: number;
    kingdomId: string;
    name: string;
    monarchName: string;
    civilization: string | null;
    honor: number;
    glory: number;
    isPlayer: boolean;
  }>;
}

interface SideResult {
  name: string;
  initial: number;
  survivors: number;
  casualties: number;
  wounded: number;
  dead: number;
  lossRatio: number;
  retreated: boolean;
  casualtiesComposition: Record<string, number>;
}

interface BattleRecord {
  _id: string;
  resolvedAt: number;
  outcome: string;
  crushingVictory: boolean;
  role: 'attacker' | 'defender';
  report: {
    outcome: string;
    rounds: Array<{ round: number; ratio: number; attackerCasualties: number; defenderCasualties: number }>;
    attacker: SideResult;
    defender: SideResult;
    explanation: string[];
    honorAwarded: { attacker: number; defender: number; pending: boolean };
    gloryAwarded: { attacker: number; defender: number; pending: boolean };
    equipmentWear: { attacker: number; defender: number };
    lootTransferred: boolean;
  };
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente de respuesta',
  ACCEPTED: 'Aceptado · programado',
  FROZEN: 'Contingentes congelados',
  RESOLVED: 'Resuelto',
  REJECTED: 'Rechazado',
  EXPIRED: 'Caducado',
};

const WINDOW_LABELS: Record<string, string> = {
  proxima: 'Más próxima',
  dias: 'Dentro de unos días',
  semana: 'En una semana',
};

const CIVILIZATION_LABELS: Record<string, string> = {
  ingleses: 'Ingleses', romanos: 'Romanos', griegos: 'Griegos', vikingos: 'Vikingos', bizantinos: 'Bizantinos', arabes: 'Árabes',
  mongoles: 'Mongoles', chinos: 'Chinos', japoneses: 'Japoneses', navajos: 'Navajos', aztecas: 'Aztecas', masais: 'Masáis',
};

export function ParliamentPanel(props: {
  kingdomId: string;
  isOwner: boolean;
  kingdomName: string;
  taxRate: number | null;
  lastDailyBonusAt: number | null;
  dailyBonusCooldownMs: number;
  dailyBonusHonor: number;
}) {
  const { kingdomId, isOwner } = props;
  const parliament = useQuery(getParliamentQuery, kingdomId ? { kingdomId } : "skip") as ParliamentState | undefined;
  const rivals = useQuery(listRivalsQuery, kingdomId ? { kingdomId } : "skip") as RivalsState | undefined;
  const worldMap = useQuery(getWorldMapQuery, kingdomId ? { kingdomId } : "skip") as {
    cells?: Array<{
      cellId: string;
      state: string;
      ownerKingdomId: string | null;
      ownerName: string | null;
    }>;
  } | undefined;
  const battles = useQuery(getBattlesQuery, kingdomId ? { kingdomId } : "skip") as BattleRecord[] | undefined;
  const leaderboard = useQuery(getLeaderboardQuery, kingdomId ? { kingdomId } : "skip") as LeaderboardState | undefined;
  const createChallenge = useMutation(createChallengeMutation);
  const acceptChallenge = useMutation(acceptChallengeMutation);
  const rejectChallenge = useMutation(rejectChallengeMutation);
  const sendMessage = useMutation(sendPredefinedMessageMutation);
  const requestReport = useMutation(requestEspionageReportMutation);
  const claimDailyBonus = useMutation(claimDailyBonusMutation);
  const setTaxRate = useMutation(setTaxRateMutation);
  const serverNow = useServerClock(parliament?.serverTimeMs);
  const action = useActionState();

  const [windowChoice, setWindowChoice] = useState<Record<string, string>>({});
  const [messageChoice, setMessageChoice] = useState<Record<string, string>>({});
  const [taxInput, setTaxInput] = useState<number | null>(null);
  const [openBattle, setOpenBattle] = useState<string | null>(null);

  if (!parliament) {
    return <p className="text-xs text-[#8e816d] italic p-4">Convocando al Parlamento…</p>;
  }
  const writable = isOwner && parliament.writable;
  const hasParliament = parliament.parliamentLevel >= parliament.requiredParliamentLevel;
  const currentTax = taxInput ?? Math.round((props.taxRate ?? 0.1) * 100);
  const nextBonusAt = (props.lastDailyBonusAt ?? 0) + props.dailyBonusCooldownMs;
  const bonusAvailable = serverNow >= nextBonusAt;

  const visibleRivals = useMemo(() => {
    if (!rivals?.rivals) return [];

    // Celdas conocidas y exploradas sobre el mapa autoritativo
    const discoveredOnMap = new Set<string>();
    if (worldMap?.cells) {
      for (const cell of worldMap.cells) {
        if (cell.state !== 'fog' && cell.ownerKingdomId && cell.ownerKingdomId !== kingdomId) {
          discoveredOnMap.add(cell.ownerKingdomId);
        }
      }
    }

    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const filtered: typeof rivals.rivals = [];

    for (const rival of rivals.rivals) {
      // 1. Excluir el propio reino
      if (rival.kingdomId === kingdomId) continue;

      // 2. Excluir duplicados de identificador
      if (seenIds.has(rival.kingdomId)) continue;

      // 3. Excluir reinos de demostración, pruebas o verificación
      if (isTestOrDemoKingdom({ name: rival.name })) continue;

      // 4. Si el mapa ya ha cargado sus celdas, verificar estrictamente descubrimiento en mapa
      if (worldMap?.cells && worldMap.cells.length > 0) {
        if (!discoveredOnMap.has(rival.kingdomId)) continue;
      }

      // 5. Excluir duplicados por nombre normalizado (evitar que el mismo nombre aparezca 2 veces)
      const normName = (rival.name || '').toLowerCase().trim();
      if (normName && seenNames.has(normName)) continue;
      if (normName) seenNames.add(normName);

      seenIds.add(rival.kingdomId);
      filtered.push(rival);
    }

    return filtered;
  }, [rivals?.rivals, worldMap?.cells, kingdomId]);

  const handleCreate = (rivalKingdomId: string, rivalName: string) =>
    action.run(`challenge-${rivalKingdomId}`, async () => {
      const result = await createChallenge({ challengerKingdomId: kingdomId, targetKingdomId: rivalKingdomId, challengeType: 'batalla' });
      if (result && result.success === false) return result;
      return `Desafío enviado a ${rivalName}; caduca ${formatDateTime(result.expiresAt)}${typeof result.distance === 'number' ? ` · distancia ${result.distance} hexágonos` : ''}.`;
    });

  const handleAccept = (challengeId: string) =>
    action.run(`accept-${challengeId}`, async () => {
      const result = await acceptChallenge({ kingdomId, challengeId, window: windowChoice[challengeId] ?? 'proxima' });
      if (result && result.success === false) return result;
      return `Batalla programada para ${formatDateTime(result.scheduledAt)}; los contingentes se congelan ${formatDateTime(result.freezeAt)}.`;
    });

  const handleReject = (challengeId: string, rivalName: string) => {
    if (!window.confirm(`¿Rechazar el desafío de ${rivalName}? Se aplica una penalización del 2 % de cada recurso (mínimo 10, máximo 500).`)) return;
    action.run(`reject-${challengeId}`, async () => {
      const result = await rejectChallenge({ kingdomId, challengeId });
      if (result && result.success === false) return result;
      return `Desafío rechazado. Penalización aplicada: ${formatCosts(result.penalty)}.`;
    });
  };

  const handleMessage = (challengeId: string) =>
    action.run(`message-${challengeId}`, async () => {
      const result = await sendMessage({ kingdomId, challengeId, messageId: messageChoice[challengeId] ?? parliament.predefinedMessages[0].id });
      if (result && result.success === false) return result;
      return `Mensaje enviado: "${result.text}".`;
    });

  const handleSpy = (targetKingdomId: string, name: string) =>
    action.run(`spy-${targetKingdomId}`, async () => {
      const result = await requestReport({ kingdomId, targetKingdomId });
      if (result && result.success === false) return result;
      return `Informe de ${name} (nivel ${result.level}) por ${result.cost} oro: ejército estimado ${result.estimate.min}-${result.estimate.max}.`;
    });

  const handleBonus = () =>
    action.run('bonus', async () => {
      const result = await claimDailyBonus({ kingdomId });
      if (result && result.success === false) return result;
      return `Bonus diario reclamado: +${result.awarded} honor (total ${result.honor}).`;
    });

  const handleTax = () =>
    action.run('tax', async () => {
      const result = await setTaxRate({ kingdomId, taxRate: currentTax / 100 });
      if (result && result.success === false) return result;
      setTaxInput(null);
      return `Tasa impositiva fijada en ${Math.round(result.taxRate * 100)} %.`;
    });

  const incoming = parliament.challenges.filter((c) => c.direction === 'incoming');
  const outgoing = parliament.challenges.filter((c) => c.direction === 'outgoing');

  const renderChallenge = (c: ParliamentState['challenges'][number]) => {
    const countdownTarget = c.status === 'PENDING' ? c.expiresAt : c.status === 'ACCEPTED' ? c.freezeAt : c.status === 'FROZEN' ? c.scheduledAt : null;
    const countdown = countdownTarget ? Math.max(0, (countdownTarget - serverNow) / 1000) : null;
    return (
      <div key={c._id} className={`${cardClass} text-[11px] space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-[#f0e8d4] text-xs">
            {c.direction === 'incoming' ? `${c.rivalName} te desafía` : `Desafío a ${c.rivalName}`}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[#d4af37]">{STATUS_LABELS[c.status] ?? c.status}</span>
        </div>
        <p className="text-[#8e816d]">
          Creado {formatDateTime(c.createdAt)}
          {c.distance !== null ? ` · distancia ${c.distance} hexágonos` : ''}
          {c.marchSeconds !== null ? ` · marcha ${formatSecondsDuration(c.marchSeconds)}` : ''}
          {c.scheduledAt ? ` · batalla ${formatDateTime(c.scheduledAt)} (${WINDOW_LABELS[c.window ?? ''] ?? c.window})` : ''}
        </p>
        {countdown !== null && (
          <p className="text-amber-300">
            {c.status === 'PENDING' ? 'Caduca en' : c.status === 'ACCEPTED' ? 'Congelación del contingente en' : 'Batalla en'} {formatSecondsDuration(countdown)}
          </p>
        )}
        {c.status === 'RESOLVED' && <p className="text-emerald-300">Resuelto {formatDateTime(c.resolvedAt)}; consulta el informe en el historial de batallas.</p>}
        {c.messages.length > 0 && (
          <ul className="space-y-0.5 text-[#c7beac]">
            {c.messages.map((m, index) => (
              <li key={index}>
                <span className="text-[#8e816d]">{m.fromKingdomId === kingdomId ? props.kingdomName : c.rivalName}:</span> {m.text}
              </li>
            ))}
          </ul>
        )}
        {writable && c.direction === 'incoming' && c.status === 'PENDING' && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select className={selectClass} value={windowChoice[c._id] ?? 'proxima'} onChange={(e) => setWindowChoice({ ...windowChoice, [c._id]: e.target.value })}>
              {Object.entries(parliament.windows).map(([id, ms]) => (
                <option key={id} value={id}>{WINDOW_LABELS[id] ?? id}: {formatDateTime(serverNow + ms)}</option>
              ))}
            </select>
            <button type="button" className={primaryButton} disabled={action.busy !== null} onClick={() => handleAccept(c._id)}>
              {action.busy === `accept-${c._id}` ? 'Aceptando…' : 'Aceptar'}
            </button>
            <button type="button" className={dangerButton} disabled={action.busy !== null} onClick={() => handleReject(c._id, c.rivalName)}>
              {action.busy === `reject-${c._id}` ? 'Rechazando…' : 'Rechazar (penalización 2 %)'}
            </button>
          </div>
        )}
        {writable && ['PENDING', 'ACCEPTED', 'FROZEN'].includes(c.status) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <select className={selectClass} value={messageChoice[c._id] ?? parliament.predefinedMessages[0].id} onChange={(e) => setMessageChoice({ ...messageChoice, [c._id]: e.target.value })}>
              {parliament.predefinedMessages.map((m) => (
                <option key={m.id} value={m.id}>{m.text}</option>
              ))}
            </select>
            <button type="button" className={primaryButton} disabled={action.busy !== null} onClick={() => handleMessage(c._id)}>
              {action.busy === `message-${c._id}` ? 'Enviando…' : 'Enviar mensaje'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderBattle = (battle: BattleRecord) => {
    const r = battle.report;
    const mine = battle.role === 'attacker' ? r.attacker : r.defender;
    const theirs = battle.role === 'attacker' ? r.defender : r.attacker;
    const myOutcome = r.outcome === 'empate' ? 'Empate' : (battle.role === 'attacker') === (r.outcome === 'victoria') ? 'Victoria' : 'Derrota';
    const open = openBattle === battle._id;
    return (
      <div key={battle._id} className={`${cardClass} text-[11px] space-y-2`}>
        <button type="button" className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpenBattle(open ? null : battle._id)}>
          <span className="font-semibold text-[#f0e8d4] text-xs">
            {myOutcome}{battle.crushingVictory ? ' aplastante' : ''} · {mine.name} contra {theirs.name}
          </span>
          <span className="text-[#8e816d]">{formatDateTime(battle.resolvedAt)} {open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {[mine, theirs].map((side, index) => (
                <div key={index} className="rounded border border-[#2b2419] bg-[#100e0b] p-2">
                  <span className="font-semibold text-[#e6ded0] block">{side.name}{index === 0 ? ' (tú)' : ''}</span>
                  <span className="text-[#c7beac] block">Iniciales {side.initial} · supervivientes {side.survivors}</span>
                  <span className="text-rose-300 block">Muertos {side.dead} · heridos {side.wounded} · pérdidas {(side.lossRatio * 100).toFixed(1)} %</span>
                  {side.retreated && <span className="text-amber-300 block">Se retiró</span>}
                  <span className="text-[#8e816d] block">
                    Bajas: {Object.entries(side.casualtiesComposition).filter(([, n]) => n > 0).map(([type, n]) => `${UNIT_LABELS[type] ?? type} ${n}`).join(', ') || 'ninguna'}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <span className="font-semibold text-[#e6ded0] block">Por qué se decidió así</span>
              <ul className="list-disc pl-4 text-[#c7beac] space-y-0.5">
                {r.explanation.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            </div>
            <p className="text-[#8e816d]">
              Rondas: {r.rounds.map((round) => `R${round.round} ratio ${round.ratio.toFixed(2)}`).join(' · ')}
            </p>
            <p className="text-[#8e816d]">
              Honor y gloria: {r.honorAwarded.pending
                ? 'importes pendientes de balance (P50-P51)'
                : `tú +${battle.role === 'attacker' ? r.honorAwarded.attacker : r.honorAwarded.defender} honor / ${battle.role === 'attacker' ? r.gloryAwarded.attacker : r.gloryAwarded.defender} gloria · rival +${battle.role === 'attacker' ? r.honorAwarded.defender : r.honorAwarded.attacker} honor / ${battle.role === 'attacker' ? r.gloryAwarded.defender : r.gloryAwarded.attacker} gloria`}
              {' · '}Desgaste de equipo: {battle.role === 'attacker' ? r.equipmentWear.attacker : r.equipmentWear.defender} %
              {' · '}Botín: {r.lootTransferred ? 'transferido' : 'sin botín (D-31)'}
              {' · '}Territorio: {battle.crushingVictory ? 'el vencedor puede reclamar un territorio libre cercano' : 'sin cambios'}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PanelSection
        icon={<Landmark className="w-4 h-4 text-[#d4af37]" />}
        title="Parlamento"
        aside={<span>Nivel {parliament.parliamentLevel} · honor {parliament.honor} · gloria {parliament.glory} · reclamaciones territoriales {parliament.pendingTerritoryClaims}</span>}
      >
        {!hasParliament && (
          <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded p-3">
            Se necesita Parlamento nivel {parliament.requiredParliamentLevel} para enviar o recibir desafíos (D-42). Constrúyelo desde la Aldea.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className={`${cardClass} space-y-2`}>
            <span className="font-semibold text-[#e6ded0] flex items-center gap-1.5"><Award className="w-3.5 h-3.5 text-[#d4af37]" /> Bonus diario (P59)</span>
            <p className="text-[#8e816d]">+{props.dailyBonusHonor} honor una vez cada 24 horas, validado por el servidor.</p>
            {writable ? (
              <button type="button" className={primaryButton} disabled={!bonusAvailable || action.busy !== null} onClick={handleBonus}>
                {action.busy === 'bonus' ? 'Reclamando…' : bonusAvailable ? 'Reclamar bonus' : `Disponible en ${formatSecondsDuration((nextBonusAt - serverNow) / 1000)}`}
              </button>
            ) : (
              <p className="text-[#8e816d] italic">{readOnlyNote}</p>
            )}
          </div>
          <div className={`${cardClass} space-y-2`}>
            <span className="font-semibold text-[#e6ded0] flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-amber-400" /> Impuestos (P27)</span>
            <p className="text-[#8e816d]">0 %–100 %. Por encima del 10 % baja la felicidad; del 30 % al 60 % penaliza la productividad hasta un 15 %; más del 60 % reduce la moral militar.</p>
            <div className="flex items-center gap-2">
              <input className={`${inputClass} w-20 text-right`} type="number" min={0} max={100} step={1} value={currentTax} disabled={!writable} onChange={(e) => setTaxInput(Number(e.target.value))} />
              <span className="text-[#c7beac]">%</span>
              {writable && (
                <button type="button" className={primaryButton} disabled={action.busy !== null || taxInput === null} onClick={handleTax}>
                  {action.busy === 'tax' ? 'Guardando…' : 'Fijar tasa'}
                </button>
              )}
            </div>
          </div>
        </div>
        <StatusMessages error={action.error} message={action.message} />
      </PanelSection>

      <PanelSection icon={<Scroll className="w-4 h-4 text-rose-400" />} title="Desafíos" aside={<span>{parliament.badgeCount} pendiente(s) de tu respuesta</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Recibidos</h3>
            {incoming.length ? incoming.map(renderChallenge) : <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">Nadie te ha desafiado.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider">Enviados</h3>
            {outgoing.length ? outgoing.map(renderChallenge) : <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">No has enviado desafíos.</p>}
          </div>
        </div>
        <p className="text-[10px] text-[#615545]">
          No existen ataques sorpresa (P38): todo combate pasa por el Parlamento. Rechazar cuesta el 2 % de cada recurso; aceptar fija la batalla a 1, 3 o 7 días reales y congela el contingente 15 minutos antes.
        </p>
      </PanelSection>

      <PanelSection icon={<Eye className="w-4 h-4 text-sky-400" />} title="Reinos rivales (P42)">
        {!rivals ? (
          <p className="text-xs text-[#8e816d] italic">Consultando reinos…</p>
        ) : visibleRivals.length === 0 ? (
          <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">
            Aún no has descubierto otros reinos en el mapa. Envía expediciones de exploración para entablar contacto diplomático.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleRivals.map((rival) => (
              <div key={rival.kingdomId} className={`${cardClass} text-[11px] space-y-1.5`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#f0e8d4] text-xs">{rival.name}</span>
                  <span className="text-[#8e816d]">{rival.civilization ? CIVILIZATION_LABELS[rival.civilization] ?? rival.civilization : 'sin civilización'}</span>
                </div>
                <p className="text-[#c7beac]">
                  Población: aproximadamente {rival.approximatePopulation.toLocaleString('es-ES')} · Ejército estimado: {rival.armyEstimate.min.toLocaleString('es-ES')}–{rival.armyEstimate.max.toLocaleString('es-ES')} (±{Math.round(rival.armyEstimate.error * 100)} %) · Honor: {rival.honor}
                </p>
                <p className="text-[#8e816d]">
                  Parlamento nivel {rival.parliamentLevel}{rival.distance !== null ? ` · distancia ${rival.distance} hexágonos` : ''}
                  {rival.espionageReport ? ` · informe nivel ${rival.espionageReport.level} válido hasta ${formatDateTime(rival.espionageReport.expiresAt)}` : ''}
                </p>
                {rival.espionageReport?.composition && (
                  <p className="text-sky-300">
                    Composición estimada: {Object.entries(rival.espionageReport.composition).map(([type, range]) => `${UNIT_LABELS[type] ?? type} ${range.min}–${range.max}`).join(', ')}
                  </p>
                )}
                {writable && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={!hasParliament || !rival.canBeChallenged || action.busy !== null}
                      onClick={() => handleCreate(rival.kingdomId, rival.name)}
                      title={rival.canBeChallenged ? 'Enviar desafío de batalla' : 'El rival no tiene Parlamento'}
                    >
                      {action.busy === `challenge-${rival.kingdomId}` ? 'Enviando…' : 'Desafiar'}
                    </button>
                    <button type="button" className={primaryButton} disabled={action.busy !== null} onClick={() => handleSpy(rival.kingdomId, rival.name)} title="Requiere Espionaje I; cuesta oro">
                      {action.busy === `spy-${rival.kingdomId}` ? 'Espiando…' : 'Informe de espionaje'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection icon={<Trophy className="w-4 h-4 text-[#d4af37]" />} title="Clasificación Global de Reinos (Honor)">
        {!leaderboard ? (
          <p className="text-xs text-[#8e816d] italic">Consultando clasificación mundial…</p>
        ) : leaderboard.rankings.length === 0 ? (
          <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">No hay reinos registrados en la clasificación.</p>
        ) : (
          <div className="space-y-1.5 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2b2419] text-[#8e816d] font-serif uppercase tracking-wider text-[10px]">
                  <th className="py-2 px-3">Pos.</th>
                  <th className="py-2 px-3">Reino / Monarca</th>
                  <th className="py-2 px-3">Civilización</th>
                  <th className="py-2 px-3 text-right">Honor</th>
                  <th className="py-2 px-3 text-right">Gloria</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2b2419]/50">
                {leaderboard.rankings.map((r) => (
                  <tr key={r.kingdomId} className={r.isPlayer ? 'bg-[#251e13] text-[#f0e8d4] font-semibold' : 'text-[#c7beac] hover:bg-[#18140f]'}>
                    <td className="py-2 px-3 font-serif text-[#d4af37]">
                      {r.rank === 1 ? '🥇 1º' : r.rank === 2 ? '🥈 2º' : r.rank === 3 ? '🥉 3º' : `${r.rank}º`}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-[#f0e8d4]">{r.name}</span>
                      <span className="block text-[10px] text-[#8e816d]">Monarca: {r.monarchName}{r.isPlayer ? ' (Tú)' : ''}</span>
                    </td>
                    <td className="py-2 px-3 text-[#8e816d]">{r.civilization ? CIVILIZATION_LABELS[r.civilization] ?? r.civilization : '—'}</td>
                    <td className="py-2 px-3 text-right font-bold text-amber-300">{r.honor.toLocaleString('es-ES')}</td>
                    <td className="py-2 px-3 text-right text-purple-300">{r.glory.toLocaleString('es-ES')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelSection>

      <PanelSection icon={<Swords className="w-4 h-4 text-rose-400" />} title="Historial de batallas (P43)">
        {!battles ? (
          <p className="text-xs text-[#8e816d] italic">Consultando batallas…</p>
        ) : battles.length === 0 ? (
          <p className="text-xs text-[#8e816d] italic bg-[#18140f] p-3 rounded border border-[#2b2419]">Todavía no se ha librado ninguna batalla.</p>
        ) : (
          <div className="space-y-2">{battles.map(renderBattle)}</div>
        )}
      </PanelSection>
    </div>
  );
}
