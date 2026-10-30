import React, { useEffect, useState } from 'react';
import { useMutation, useQuery_experimental } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Award, CheckCircle2, Circle, EyeOff, Sparkles, Trophy } from 'lucide-react';
import { PanelSection, cardClass } from './shared';

/* ==========================================================================
   MISIONES (sección 17 de CLAUDE.md, decisión 2026-10-21)
   El servidor detecta, marca y premia; aquí solo se muestra el estado y la
   celebración breve (no bloquea la partida).
   ========================================================================== */
const getMissionsQuery = makeFunctionReference<'query'>('missions:getMissions');
const getCelebrationsQuery = makeFunctionReference<'query'>('missions:getMissionCelebrations');
const markSeenMutation = makeFunctionReference<'mutation'>('missions:markMissionsSeen');
const refreshMissionsMutation = makeFunctionReference<'mutation'>('missions:refreshMissions');
const finishMissionMutation = makeFunctionReference<'mutation'>('missions:finishMission');
const claimRewardMutation = makeFunctionReference<'mutation'>('missions:claimMissionReward');

interface MissionView {
  id: string;
  progressId: string;
  title: string;
  description: string;
  rewardSummary: string;
  status: 'in_progress' | 'ready_to_finish' | 'pending_claim' | 'claimed';
  completedAt: number | null;
  progress: { current: number; target: number };
}

interface MissionsState {
  serverTimeMs: number;
  writable: boolean;
  currentStage: { stage: number; title: string; total: number; rewardSummary: string; missions: MissionView[] } | null;
  completedStages: Array<{ stage: number; title: string; rewardSummary: string }>;
  daily: { dayKey: string; resetsAt: number; missions: MissionView[] };
  secrets: { discovered: Array<{ id: string; progressId: string; title: string; description: string; rewardSummary: string; status: 'in_progress' | 'ready_to_finish' | 'pending_claim' | 'claimed'; completedAt: number | null }>; remaining: number };
  history: Array<{ progressId: string; title: string; kind: string; rewardSummary: string; completedAt: number }>;
}

interface MissionsErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface MissionsErrorBoundaryState {
  hasError: boolean;
}

export class MissionsErrorBoundary extends React.Component<MissionsErrorBoundaryProps, MissionsErrorBoundaryState> {
  constructor(props: MissionsErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MissionsErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Misiones no disponibles en backend remoto:', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <PanelSection
          icon={<Trophy className="w-4 h-4 text-[#d4af37]" />}
          title="Misiones"
          aside={<span className="text-[#8e816d] text-[11px]">Módulo en preparación</span>}
        >
          <div className="bg-[#18140f] border border-[#2b2419] rounded-lg p-3.5 space-y-2 text-xs text-[#c7beac]">
            <div className="flex items-center gap-2 text-[#d4af37] font-semibold text-xs">
              <span>📜 Sistema de Misiones (P50, P51, P59)</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              El sistema de misiones por etapas, diarias y secretas está implementado en la lógica del juego. El backend remoto conectado aún no tiene desplegado el módulo autoritativo en Convex.
            </p>
          </div>
        </PanelSection>
      );
    }
    return this.props.children;
  }
}

function MissionRow({ mission, kingdomId }: { mission: MissionView; kingdomId: string }) {
  const finish = useMutation(finishMissionMutation);
  const claim = useMutation(claimRewardMutation);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pct = mission.progress.target > 0 ? Math.min(100, Math.round((mission.progress.current / mission.progress.target) * 100)) : 0;

  const handleFinish = async () => {
    try {
      setErrorMsg(null);
      await finish({ kingdomId, progressId: mission.progressId });
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Error al finalizar misión');
    }
  };

  const handleClaim = async () => {
    try {
      setErrorMsg(null);
      await claim({ kingdomId, progressId: mission.progressId });
    } catch (e: any) {
      if (e.message?.includes('NO HAY SITIO EN EL MERCADO')) {
        setErrorMsg('NO HAY SITIO EN EL MERCADO: No tienes espacio suficiente en el almacén para recibir esta recompensa. Libera espacio e inténtalo de nuevo.');
      } else {
        setErrorMsg(e.message ?? 'Error al cobrar recompensa');
      }
    }
  };

  const isClaimed = mission.status === 'claimed';
  const isPendingClaim = mission.status === 'pending_claim';
  const isReadyToFinish = mission.status === 'ready_to_finish';

  return (
    <div className={`${cardClass} text-[11px] space-y-2 ${isClaimed ? 'opacity-80' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {isClaimed ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-[#6e6352] flex-shrink-0 mt-0.5" />}
          <div>
            <span className={`font-semibold block ${isClaimed ? 'text-emerald-200 line-through decoration-emerald-700' : 'text-[#f0e8d4]'}`}>{mission.title}</span>
            <span className="text-[#c7beac]">{mission.description}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isClaimed && <span className="text-[10px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded font-medium border border-emerald-800">COBRADA</span>}
          {isPendingClaim && (
            <button
              onClick={handleClaim}
              className="bg-[#d4af37] hover:bg-[#c29f2e] text-[#110e0a] font-bold px-3 py-1.5 rounded shadow text-[10px] uppercase tracking-wider transition-colors"
            >
              Cobrar recompensa
            </button>
          )}
          {isReadyToFinish && (
            <button
              onClick={handleFinish}
              className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold px-3 py-1.5 rounded shadow text-[10px] uppercase tracking-wider transition-colors"
            >
              Finalizar misión
            </button>
          )}
          {!isClaimed && !isPendingClaim && !isReadyToFinish && (
            <span className="font-mono text-[#e6ded0] whitespace-nowrap">{`${mission.progress.current.toLocaleString('es-ES')}/${mission.progress.target.toLocaleString('es-ES')}`}</span>
          )}
        </div>
      </div>

      {!isClaimed && !isPendingClaim && !isReadyToFinish && (
        <div className="h-1.5 rounded bg-[#100e0b] overflow-hidden">
          <div className="h-full bg-[#d4af37]/70" style={{ width: `${pct}%` }} />
        </div>
      )}

      <p className="text-[#8e816d]">Premio: {mission.rewardSummary}</p>

      {errorMsg && (
        <div className="bg-[#2a1212] border border-[#7f1d1d] text-red-200 p-2 rounded text-[10px] space-y-1">
          <p className="font-bold uppercase tracking-wide">NO HAY SITIO EN EL MERCADO</p>
          <p>No tienes espacio suficiente en el almacén para recibir esta recompensa. Libera espacio e inténtalo de nuevo.</p>
        </div>
      )}
    </div>
  );
}

function SecretMissionRow({ mission, kingdomId }: { mission: MissionsState['secrets']['discovered'][number]; kingdomId: string }) {
  const finish = useMutation(finishMissionMutation);
  const claim = useMutation(claimRewardMutation);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFinish = async () => {
    try {
      setErrorMsg(null);
      await finish({ kingdomId, progressId: mission.progressId });
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Error al finalizar misión secreta');
    }
  };

  const handleClaim = async () => {
    try {
      setErrorMsg(null);
      await claim({ kingdomId, progressId: mission.progressId });
    } catch (e: any) {
      if (e.message?.includes('NO HAY SITIO EN EL MERCADO')) {
        setErrorMsg('NO HAY SITIO EN EL MERCADO: No tienes espacio suficiente en el almacén para recibir esta recompensa. Libera espacio e inténtalo de nuevo.');
      } else {
        setErrorMsg(e.message ?? 'Error al cobrar recompensa');
      }
    }
  };

  const isClaimed = mission.status === 'claimed';
  const isPendingClaim = mission.status === 'pending_claim';
  const isReadyToFinish = mission.status === 'ready_to_finish';

  return (
    <div className={`${cardClass} text-[11px] space-y-1`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold text-[#f0e8d4] block">{mission.title}</span>
          <span className="text-[#c7beac]">{mission.description}</span>
        </div>
        <div>
          {isClaimed && <span className="text-[10px] bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded font-medium border border-emerald-800">COBRADA</span>}
          {isPendingClaim && (
            <button onClick={handleClaim} className="bg-[#d4af37] text-[#110e0a] font-bold px-2.5 py-1 rounded text-[10px] uppercase">
              Cobrar recompensa
            </button>
          )}
          {isReadyToFinish && (
            <button onClick={handleFinish} className="bg-[#2563eb] text-white font-bold px-2.5 py-1 rounded text-[10px] uppercase">
              Finalizar misión
            </button>
          )}
        </div>
      </div>
      <p className="text-[#8e816d]">Premio: {mission.rewardSummary}</p>
      {errorMsg && (
        <div className="bg-[#2a1212] border border-[#7f1d1d] text-red-200 p-2 rounded text-[10px] space-y-1">
          <p className="font-bold uppercase tracking-wide">NO HAY SITIO EN EL MERCADO</p>
          <p>No tienes espacio suficiente en el almacén para recibir esta recompensa. Libera espacio e inténtalo de nuevo.</p>
        </div>
      )}
    </div>
  );
}

function MissionsPanelInner(props: { kingdomId: string; isOwner: boolean }) {
  const { kingdomId, isOwner } = props;
  const result = useQuery_experimental({
    query: getMissionsQuery,
    args: kingdomId ? { kingdomId } : 'skip',
    throwOnError: false,
  });
  const refresh = useMutation(refreshMissionsMutation);

  useEffect(() => {
    if (isOwner && result.status === 'success') {
      refresh({ kingdomId }).catch(() => undefined);
    }
  }, [kingdomId, isOwner, refresh, result.status]);

  if (result.status === 'pending') {
    return <p className="text-xs text-[#8e816d] italic p-4">Consultando las misiones en el servidor…</p>;
  }

  if (result.status === 'error') {
    return (
      <PanelSection
        icon={<Trophy className="w-4 h-4 text-[#d4af37]" />}
        title="Misiones"
        aside={<span className="text-[#8e816d] text-[11px]">Módulo en preparación</span>}
      >
        <div className="bg-[#18140f] border border-[#2b2419] rounded-lg p-3.5 space-y-2 text-xs text-[#c7beac]">
          <div className="flex items-center gap-2 text-[#d4af37] font-semibold text-xs">
            <span>📜 Sistema de Misiones (P50, P51, P59)</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            El sistema de misiones por etapas, diarias y secretas está implementado en la lógica del juego. El backend remoto conectado aún no dispone del módulo desplegado en Convex.
          </p>
        </div>
      </PanelSection>
    );
  }

  const state = result.data as MissionsState | undefined;
  if (!state) return <p className="text-xs text-[#8e816d] italic p-4">Consultando las misiones en el servidor…</p>;

  const resetIn = Math.max(0, state.daily.resetsAt - state.serverTimeMs);
  const resetHours = Math.floor(resetIn / 3_600_000);
  const resetMinutes = Math.floor((resetIn % 3_600_000) / 60_000);

  return (
    <PanelSection
      icon={<Trophy className="w-4 h-4 text-[#d4af37]" />}
      title="Misiones"
      aside={<span>{state.currentStage ? `Etapa ${state.currentStage.stage} de ${state.currentStage.total}` : 'Todas las etapas completadas'} · {state.secrets.discovered.length} secretas descubiertas</span>}
    >
      <p className="text-[11px] text-[#c7beac]">
        Cuando los objetivos se cumplan, pulsa «FINALIZAR MISIÓN» y posteriormente «COBRAR RECOMPENSA» para ingresar los premios en tu almacén. Las diarias se renuevan cada día.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" /> {state.currentStage ? `Etapa ${state.currentStage.stage}: ${state.currentStage.title}` : 'Etapas completadas'}
          </h3>
          {state.currentStage ? (
            <>
              {state.currentStage.missions.map((m) => <MissionRow key={m.progressId} mission={m} kingdomId={kingdomId} />)}
              <p className="text-[11px] text-[#8e816d]">Premio final de la etapa: {state.currentStage.rewardSummary}</p>
            </>
          ) : (
            <p className="text-[11px] text-[#8e816d] italic">Has completado todas las etapas disponibles.</p>
          )}
          {state.completedStages.length > 0 && (
            <p className="text-[11px] text-emerald-300">Etapas completadas: {state.completedStages.map((s) => `${s.stage} (${s.title})`).join(' · ')}</p>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Misiones de hoy · se renuevan en {resetHours} h {resetMinutes} min
          </h3>
          {state.daily.missions.map((m) => <MissionRow key={m.progressId} mission={m} kingdomId={kingdomId} />)}
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider flex items-center gap-1.5 pt-2">
            <EyeOff className="w-3.5 h-3.5" /> Misiones secretas
          </h3>
          {state.secrets.discovered.length === 0 ? (
            <p className="text-[11px] text-[#8e816d] italic">Ninguna descubierta todavía. Sus condiciones se revelan al cumplirse.</p>
          ) : (
            state.secrets.discovered.map((m) => <SecretMissionRow key={m.id} mission={m} kingdomId={kingdomId} />)
          )}
          <p className="text-[11px] text-[#8e816d]">{state.secrets.remaining} misiones secretas por descubrir.</p>
        </div>
      </div>
    </PanelSection>
  );
}

export function MissionsPanel(props: { kingdomId: string; isOwner: boolean }) {
  return (
    <MissionsErrorBoundary>
      <MissionsPanelInner {...props} />
    </MissionsErrorBoundary>
  );
}

function MissionCelebrationsInner(props: { kingdomId: string; enabled: boolean }) {
  const { kingdomId, enabled } = props;
  const result = useQuery_experimental({
    query: getCelebrationsQuery,
    args: enabled && kingdomId ? { kingdomId } : 'skip',
    throwOnError: false,
  });
  const pending = result.status === 'success'
    ? (result.data as Array<{ id: string; progressId: string; title: string; kind: string; stage: number | null; rewardSummary: string; completedAt: number }> | undefined)
    : undefined;
  const markSeen = useMutation(markSeenMutation);
  const [visible, setVisible] = useState<Array<{ id: string; title: string; kind: string; rewardSummary: string }>>([]);

  useEffect(() => {
    if (!pending || pending.length === 0) return;
    setVisible(pending.map((p) => ({ id: p.id, title: p.title, kind: p.kind, rewardSummary: p.rewardSummary })));
    const timer = setTimeout(() => {
      markSeen({ kingdomId, ids: pending.map((p) => p.id) }).catch(() => undefined);
      setVisible([]);
    }, 7000);
    return () => clearTimeout(timer);
  }, [pending, kingdomId, markSeen]);

  if (visible.length === 0) return null;
  const kindLabel: Record<string, string> = { stage: 'Misión completada', daily: 'Misión diaria completada', secret: 'Misión secreta revelada', stageReward: 'Etapa completada' };
  return (
    <div className="fixed bottom-20 sm:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-xs" aria-live="polite">
      <style>{`@keyframes missionPop { 0% { transform: translateY(16px) scale(0.95); opacity: 0 } 60% { transform: translateY(-4px) scale(1.02); opacity: 1 } 100% { transform: translateY(0) scale(1); opacity: 1 } }`}</style>
      {visible.map((item) => (
        <div key={item.id} className="bg-[#1b150e] border-2 border-[#d4af37]/70 rounded-xl p-3 shadow-2xl" style={{ animation: 'missionPop 600ms ease-out' }}>
          <div className="flex items-center gap-2 text-[#d4af37] text-[11px] uppercase tracking-wider font-semibold">
            <Trophy className="w-4 h-4" /> {kindLabel[item.kind] ?? 'Logro'}
          </div>
          <div className="text-sm font-serif font-bold text-[#f7f2e4] mt-1">{item.title}</div>
          <div className="text-[11px] text-[#c7beac] mt-0.5">{item.rewardSummary}</div>
        </div>
      ))}
    </div>
  );
}

/** Celebración breve y no bloqueante de las misiones completadas; se marca como vista en el servidor. */
export function MissionCelebrations(props: { kingdomId: string; enabled: boolean }) {
  return (
    <MissionsErrorBoundary fallback={null}>
      <MissionCelebrationsInner {...props} />
    </MissionsErrorBoundary>
  );
}

