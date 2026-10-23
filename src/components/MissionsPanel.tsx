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

interface MissionView {
  id: string;
  progressId: string;
  title: string;
  description: string;
  rewardSummary: string;
  completed: boolean;
  completedAt: number | null;
  progress: { current: number; target: number };
}

interface MissionsState {
  serverTimeMs: number;
  writable: boolean;
  currentStage: { stage: number; title: string; total: number; rewardSummary: string; missions: MissionView[] } | null;
  completedStages: Array<{ stage: number; title: string; rewardSummary: string }>;
  daily: { dayKey: string; resetsAt: number; missions: MissionView[] };
  secrets: { discovered: Array<{ id: string; title: string; description: string; rewardSummary: string; completedAt: number | null }>; remaining: number };
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

function MissionRow({ mission }: { mission: MissionView }) {
  const pct = mission.progress.target > 0 ? Math.min(100, Math.round((mission.progress.current / mission.progress.target) * 100)) : 0;
  return (
    <div className={`${cardClass} text-[11px] space-y-1 ${mission.completed ? 'opacity-80' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {mission.completed ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-[#6e6352] flex-shrink-0 mt-0.5" />}
          <div>
            <span className={`font-semibold block ${mission.completed ? 'text-emerald-200 line-through decoration-emerald-700' : 'text-[#f0e8d4]'}`}>{mission.title}</span>
            <span className="text-[#c7beac]">{mission.description}</span>
          </div>
        </div>
        <span className="font-mono text-[#e6ded0] whitespace-nowrap">{mission.completed ? 'hecha' : `${mission.progress.current.toLocaleString('es-ES')}/${mission.progress.target.toLocaleString('es-ES')}`}</span>
      </div>
      {!mission.completed && (
        <div className="h-1.5 rounded bg-[#100e0b] overflow-hidden">
          <div className="h-full bg-[#d4af37]/70" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-[#8e816d]">Premio: {mission.rewardSummary}</p>
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

  // Al abrir el panel, el propietario pide una reevaluación si el módulo está disponible en el servidor.
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
          <p className="text-[10px] text-[#8e816d]">
            Las misiones se activarán de inmediato en cuanto se despliegue el módulo en el servidor con autorización expresa.
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
        El servidor detecta los objetivos cumplidos y entrega el premio automáticamente, sin botón de reclamar. Las etapas se revelan una a una; las diarias son iguales para todos y se renuevan cada día.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" /> {state.currentStage ? `Etapa ${state.currentStage.stage}: ${state.currentStage.title}` : 'Etapas completadas'}
          </h3>
          {state.currentStage ? (
            <>
              {state.currentStage.missions.map((m) => <MissionRow key={m.progressId} mission={m} />)}
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
          {state.daily.missions.map((m) => <MissionRow key={m.progressId} mission={m} />)}
          <h3 className="text-xs font-semibold text-[#a89b84] uppercase tracking-wider flex items-center gap-1.5 pt-2">
            <EyeOff className="w-3.5 h-3.5" /> Misiones secretas
          </h3>
          {state.secrets.discovered.length === 0 ? (
            <p className="text-[11px] text-[#8e816d] italic">Ninguna descubierta todavía. Sus condiciones se revelan al cumplirse.</p>
          ) : (
            state.secrets.discovered.map((m) => (
              <div key={m.id} className={`${cardClass} text-[11px]`}>
                <span className="font-semibold text-[#f0e8d4] block">{m.title}</span>
                <span className="text-[#c7beac]">{m.description}</span>
                <p className="text-[#8e816d]">Premio: {m.rewardSummary}</p>
              </div>
            ))
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

