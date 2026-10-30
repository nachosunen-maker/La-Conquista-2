import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { 
  Castle, 
  Hammer, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Coins, 
  TreePine, 
  Pickaxe, 
  Anvil,
  Wheat,
  X, 
  ArrowUpRight, 
  ShieldAlert, 
  Info,
  Check
} from 'lucide-react';

import { StatusMessages } from './shared';

const getBuildingsAndQueueQuery = makeFunctionReference<"query">("kingdoms:getBuildingsAndQueue");
const startConstructionMutation = makeFunctionReference<"mutation">("kingdoms:startConstruction");
const cancelConstructionMutation = makeFunctionReference<"mutation">("kingdoms:cancelConstruction");
const completeConstructionMutation = makeFunctionReference<"mutation">("kingdoms:completeConstruction");

interface BuildingsAndQueueProps {
  kingdomId: string;
  isOwner: boolean;
}

export function BuildingsAndQueueView({ kingdomId, isOwner }: BuildingsAndQueueProps) {
  const data = useQuery(getBuildingsAndQueueQuery, { kingdomId });

  const startConstruction = useMutation(startConstructionMutation);
  const cancelConstruction = useMutation(cancelConstructionMutation);
  const completeConstruction = useMutation(completeConstructionMutation);

  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Reloj local para actualizar progreso de obra en tiempo real
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleStartUpgrade = async (buildingType: string, buildingName: string) => {
    if (!isOwner) {
      setActionError("Modo Demostración / Consulta: No tienes permisos para iniciar construcciones en este reino.");
      return;
    }
    setBusyActionId(buildingType);
    setActionError(null);
    setActionSuccessMessage(null);
    try {
      const res = await startConstruction({ kingdomId, buildingType });
      if (res && res.success) {
        setActionSuccessMessage(`¡Construcción iniciada! '${buildingName}' nivel ${res.targetLevel} en curso (${Math.round(res.durationSeconds / 60)} min).`);
      } else if (res && !res.success) {
        setActionError(res.error || "Error al iniciar la construcción.");
      }
    } catch (err: any) {
      setActionError(err?.message || "Error al iniciar la construcción.");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCancelWork = async (constructionId: string, buildingName: string) => {
    if (!isOwner) return;
    setBusyActionId(constructionId);
    setActionError(null);
    setActionSuccessMessage(null);
    try {
      const res = await cancelConstruction({ constructionId });
      if (res && res.success) {
        if (res.wasCompletedInstead) {
          setActionSuccessMessage(`La obra de '${buildingName}' ya había finalizado y se ha completado.`);
        } else {
          setActionSuccessMessage(`Construcción cancelada. Se ha reembolsado el 50% de los recursos de '${buildingName}'.`);
        }
      }
    } catch (err: any) {
      setActionError(err?.message || "Error al cancelar la construcción.");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleCompleteWork = async (constructionId: string, buildingName: string) => {
    if (!isOwner) return;
    setBusyActionId(constructionId);
    setActionError(null);
    setActionSuccessMessage(null);
    try {
      const res = await completeConstruction({ constructionId });
      if (res && res.success) {
        setActionSuccessMessage(`¡Obra completada! '${buildingName}' ha alcanzado el nivel ${res.newLevel}.`);
      }
    } catch (err: any) {
      setActionError(err?.message || "Error al completar la construcción.");
    } finally {
      setBusyActionId(null);
    }
  };

  if (!data) {
    return (
      <div className="py-12 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 text-[#d4af37] animate-spin" />
        <p className="text-xs text-[#8e816d] font-serif">Cargando catálogo de edificios y cuadrilla de obras...</p>
      </div>
    );
  }

  const { slots, buildings, activeConstructionsCount, maxSlots } = data;

  return (
    <div className="space-y-6">
      {/* Mensajes de feedback */}
      <StatusMessages error={actionError} message={actionSuccessMessage} isConstruction={true} />


      {/* ====================================================================
          1. LAS DOS PLAZAS DE CONSTRUCCIÓN SIMULTÁNEA (COLA PERSISTENTE)
          ==================================================================== */}
      <section className="bg-[#17130e] border border-[#382f20] rounded-xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#2b2216] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#241c12] border border-[#d4af37]/40 rounded-lg text-[#d4af37]">
              <Hammer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#f5efe1]">
                  Cuadrilla de Obras Reales
                </h2>
                <span className="text-[10px] text-amber-400 bg-amber-950/50 border border-amber-800/50 px-2 py-0.5 rounded font-mono">
                  {activeConstructionsCount} / {maxSlots} Plazas Ocupadas
                </span>
              </div>
              <p className="text-[11px] text-[#8e816d]">
                Máximo de 2 construcciones simultáneas gestionadas por el servidor de forma persistente.
              </p>
            </div>
          </div>
          {!isOwner && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/40 border border-amber-900/60 rounded text-[11px] text-amber-300 font-mono">
              <Info className="w-3.5 h-3.5" />
              <span>Modo Lectura (Demostración)</span>
            </div>
          )}
        </div>

        {/* Rejilla de las 2 plazas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {slots.map((slot: any) => {
            const item = slot.item;
            return (
              <div
                key={slot.slotIndex}
                className={`border rounded-xl p-4 flex flex-col justify-between transition-all ${
                  slot.status === 'empty'
                    ? 'bg-[#120f0c] border-[#292218] border-dashed'
                    : 'bg-[#1a1510] border-[#3d3221] shadow-md'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-serif font-semibold text-[#a3947e] uppercase tracking-wider">
                      Plaza de Obra #{slot.slotIndex + 1}
                    </span>
                    {slot.status === 'empty' ? (
                      <span className="text-[10px] text-[#786c5a] bg-[#1d1711] px-2 py-0.5 rounded font-mono">
                        Disponible
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-2 py-0.5 rounded font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                        En curso
                      </span>
                    )}
                  </div>

                  {slot.status === 'empty' || !item ? (
                    <div className="py-6 text-center space-y-1">
                      <Castle className="w-8 h-8 text-[#382e21] mx-auto" />
                      <p className="text-xs text-[#786c5a] font-serif">Plaza libre para iniciar edificación</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="text-2xl p-2 bg-[#241c12] border border-[#d4af37]/30 rounded-lg">
                          {item.buildingEmoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-serif font-bold text-[#f5efe1] truncate">
                            {item.buildingName}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-[#a3947e] mt-0.5">
                            <span>Nivel {item.currentLevel}</span>
                            <span className="text-[#d4af37]">➔</span>
                            <span className="text-[#d4af37] font-semibold">Nivel {item.targetLevel}</span>
                          </div>
                        </div>
                      </div>

                      {/* Barra de progreso */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[11px] text-[#a3947e]">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#d4af37]" />
                            <span>{item.isReadyToComplete ? 'Obra finalizada' : `Faltan ${Math.floor(item.remainingSeconds / 60)}m ${item.remainingSeconds % 60}s`}</span>
                          </span>
                          <span className="font-mono text-[#d4af37]">{item.progressPercent}%</span>
                        </div>
                        <div className="w-full h-2 bg-[#120f0c] rounded-full overflow-hidden border border-[#2b2216]">
                          <div
                            className={`h-full transition-all duration-500 rounded-full ${
                              item.isReadyToComplete
                                ? 'bg-emerald-500'
                                : 'bg-gradient-to-r from-amber-600 to-[#d4af37]'
                            }`}
                            style={{ width: `${Math.min(100, item.progressPercent)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botones de acción de la plaza (Completar / Cancelar) */}
                {slot.status === 'in_progress' && item && isOwner && (
                  <div className="pt-3.5 mt-3.5 border-t border-[#292218] flex items-center justify-between gap-2">
                    {item.isReadyToComplete ? (
                      <button
                        type="button"
                        disabled={busyActionId === item._id}
                        onClick={() => handleCompleteWork(item._id!, item.buildingName)}
                        className="w-full py-1.5 px-3 bg-emerald-800 hover:bg-emerald-700 text-white rounded text-xs font-serif font-semibold shadow transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        {busyActionId === item._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Completar Obra</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyActionId === item._id}
                        onClick={() => handleCancelWork(item._id!, item.buildingName)}
                        className="w-full py-1.5 px-3 bg-rose-950/80 hover:bg-rose-900 border border-rose-800/80 text-rose-200 rounded text-xs font-serif font-semibold shadow transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                        title="Cancela la construcción y devuelve el 50% de los recursos"
                      >
                        {busyActionId === item._id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                        <span>Cancelar Obra (Devolución 50%)</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ====================================================================
          2. CATÁLOGO DE EDIFICIOS DEL REINO Y MEJORAS HASTA NIVEL 100
          ==================================================================== */}
      <section className="bg-[#17130e] border border-[#382f20] rounded-xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="border-b border-[#2b2216] pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#f5efe1]">
              Edificios y Infraestructura del Reino
            </h2>
            <p className="text-[11px] text-[#8e816d] mt-0.5">
              Nivel máximo 100. Cada nivel superior incrementa un 1% la duración de construcción.
            </p>
          </div>
        </div>

        {/* Rejilla de edificios */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {buildings.map((b: any) => {
            const isBusy = busyActionId === b.type;
            const cost = b.nextCost;
            return (
              <div
                key={b.type}
                className="bg-[#120f0c] border border-[#2e261b] hover:border-[#d4af37]/40 rounded-xl p-4 flex flex-col justify-between transition-all shadow-md space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl p-2 bg-[#1b1510] border border-[#382e21] rounded-lg">
                        {b.emoji}
                      </span>
                      <div>
                        <h3 className="text-sm font-serif font-bold text-[#f5efe1]">{b.name}</h3>
                        <span className="text-[11px] text-[#d4af37] font-mono font-semibold">
                          Nivel {b.currentLevel} {b.isMaxLevel && '(Máx)'}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#8e816d] bg-[#1a1410] border border-[#2b2216] px-2 py-0.5 rounded uppercase font-mono">
                      {b.category}
                    </span>
                  </div>

                  <p className="text-xs text-[#a3947e] leading-relaxed">
                    {b.description}
                  </p>

                  {/* Pre requisitos o bloqueos */}
                  {b.prerequisites && b.prerequisites.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {b.prerequisites.map((p: any, idx: number) => (
                        <div key={idx} className="text-[11px] text-[#8e816d] flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#d4af37]/60"></span>
                          <span>{p.description}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Costes del siguiente nivel */}
                  {!b.isMaxLevel && cost && (
                    <div className="bg-[#17130e] border border-[#292218] rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-[#a3947e] font-serif">
                        <span>Coste de mejora (Nivel {b.targetLevel}):</span>
                        <span className="flex items-center gap-1 text-[#d4af37] font-mono">
                          <Clock className="w-3 h-3" />
                          <span>{Math.round((b.nextDurationSeconds ?? 0) / 60)} min</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-mono">
                        {cost.gold > 0 && (
                          <span className="text-amber-300 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/40">
                            🪙 {cost.gold}
                          </span>
                        )}
                        {cost.wood > 0 && (
                          <span className="text-amber-600 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/40">
                            🪵 {cost.wood}
                          </span>
                        )}
                        {cost.stone > 0 && (
                          <span className="text-slate-300 bg-slate-900/40 px-1.5 py-0.5 rounded border-slate-800">
                            ⛏️ {cost.stone}
                          </span>
                        )}
                        {cost.iron > 0 && (
                          <span className="text-zinc-300 bg-zinc-900/40 px-1.5 py-0.5 rounded border-zinc-800">
                            ⛓️ {cost.iron}
                          </span>
                        )}
                        {cost.food > 0 && (
                          <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border-emerald-900/40">
                            🌾 {cost.food}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Botón de mejora o motivo de bloqueo */}
                <div className="pt-2 border-t border-[#221b13]">
                  {b.isMaxLevel ? (
                    <div className="w-full py-2 text-center text-xs text-[#d4af37] font-serif bg-[#1a1410] border border-[#d4af37]/30 rounded">
                      Nivel Máximo Alcanzado (100)
                    </div>
                  ) : b.isInConstruction ? (
                    <div className="w-full py-2 text-center text-xs text-amber-400 font-serif bg-amber-950/30 border border-amber-900/50 rounded">
                      Construcción en curso...
                    </div>
                  ) : b.canUpgrade ? (
                    <button
                      type="button"
                      disabled={!isOwner || isBusy}
                      onClick={() => handleStartUpgrade(b.type, b.name)}
                      className="w-full py-2 px-3 bg-[#261e14] hover:bg-[#352a1b] border border-[#d4af37]/50 hover:border-[#d4af37] rounded text-[#d4af37] text-xs font-serif font-semibold tracking-wider uppercase shadow transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Iniciando obra...</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                          <span>Mejorar a Nivel {b.targetLevel}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div
                      className="w-full py-2 px-2.5 text-center text-[11px] text-rose-300/90 font-serif bg-rose-950/30 border border-rose-950 rounded cursor-help truncate"
                      title={b.upgradeBlockReason || "Acción bloqueada"}
                    >
                      🔒 {b.upgradeBlockReason || "Requisitos no cumplidos"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
