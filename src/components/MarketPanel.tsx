import React, { useState, useId } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { 
  ArrowRightLeft, 
  Lock, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  History, 
  Sparkles,
  Info,
  Scale
} from 'lucide-react';
import {
  RESOURCE_COMMERCIAL_VALUES,
  MARKET_RESOURCE_NAMES,
  MARKET_RESOURCE_EMOJIS,
  UNLOCK_MERCADO_MIN_LEVEL,
  VALID_MARKET_RESOURCES,
  getExchangeBatchInfo,
  calculateExchange,
  type MarketResourceType,
} from '../../convex/market';

const getMarketInfoQuery = makeFunctionReference<'query'>('market:getMarketInfo');
const executeExchangeMutation = makeFunctionReference<'mutation'>('market:executeResourceExchange');

interface MarketPanelProps {
  kingdomId: any;
  isOwner: boolean;
  resources?: {
    gold: number;
    wood: number;
    stone: number;
    iron: number;
    food: number;
  };
  storageCapacity?: number | null;
  buildingLevels?: Record<string, number>;
}

export function MarketPanel({
  kingdomId,
  isOwner,
  resources,
  storageCapacity,
  buildingLevels,
}: MarketPanelProps) {
  const marketData = useQuery(getMarketInfoQuery, { kingdomId });
  const executeExchange = useMutation(executeExchangeMutation);

  // Nivel de mercado: preferir el devuelto por la consulta o del registro de edificios
  const mercadoLevel = marketData?.mercadoLevel ?? buildingLevels?.mercado ?? 0;
  const isUnlocked = mercadoLevel >= UNLOCK_MERCADO_MIN_LEVEL;

  // Estados de intercambio
  const [fromResource, setFromResource] = useState<MarketResourceType>('gold');
  const [toResource, setToResource] = useState<MarketResourceType>('wood');
  const [amountStr, setAmountStr] = useState<string>('5');
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Información de lote y cálculo
  const batchInfo = getExchangeBatchInfo(fromResource, toResource);
  const inputAmount = parseInt(amountStr, 10) || 0;
  const exchangeCalc = calculateExchange(fromResource, toResource, inputAmount);

  // Saldos y almacén
  const currentFrom = resources ? resources[fromResource] : 0;
  const currentTo = resources ? resources[toResource] : 0;
  const effectiveCapacity = storageCapacity ?? 10_000;
  const spaceAvailable = Math.max(0, effectiveCapacity - currentTo);
  const willExceedStorage = exchangeCalc.valid && currentTo + exchangeCalc.toAmount > effectiveCapacity;
  const hasEnoughFrom = currentFrom >= inputAmount;

  // Manejo de cambio de recurso origen
  const handleSelectFrom = (res: MarketResourceType) => {
    setFromResource(res);
    setFeedback(null);
    if (res === toResource) {
      // Elegir otro recurso diferente como destino
      const alternative = VALID_MARKET_RESOURCES.find((r) => r !== res) || 'wood';
      setToResource(alternative);
    }
  };

  // Manejo de cambio de recurso destino
  const handleSelectTo = (res: MarketResourceType) => {
    if (res === fromResource) return;
    setToResource(res);
    setFeedback(null);
  };

  // Presets de cantidad
  const handleSetPreset = (multiplier: number) => {
    const target = batchInfo.minFromBatch * multiplier;
    setAmountStr(String(target));
    setFeedback(null);
  };

  const handleSetMax = () => {
    if (currentFrom <= 0) return;
    // Máximo número entero de lotes que el jugador puede pagar
    const maxBatchesByBalance = Math.floor(currentFrom / batchInfo.minFromBatch);
    // Máximo número de lotes que caben en almacén
    const maxBatchesByStorage = Math.floor(spaceAvailable / batchInfo.minToBatch);
    const maxBatches = Math.max(1, Math.min(maxBatchesByBalance, maxBatchesByStorage > 0 ? maxBatchesByStorage : maxBatchesByBalance));
    setAmountStr(String(maxBatches * batchInfo.minFromBatch));
    setFeedback(null);
  };

  // Ejecución del intercambio
  const handleExecuteTrade = async () => {
    if (!isOwner) {
      setFeedback({ type: 'error', message: 'No tienes autorización para comerciar en este reino.' });
      return;
    }
    if (!isUnlocked) {
      setFeedback({ type: 'error', message: 'Mejora el Mercado al nivel 4 para desbloquear el intercambio de recursos.' });
      return;
    }
    if (!exchangeCalc.valid) {
      setFeedback({ type: 'error', message: exchangeCalc.error || 'Cálculo de intercambio inválido.' });
      return;
    }
    if (!hasEnoughFrom) {
      setFeedback({
        type: 'error',
        message: `Saldo insuficiente de ${MARKET_RESOURCE_NAMES[fromResource]}: disponible ${Math.floor(currentFrom)}, requerido ${inputAmount}.`,
      });
      return;
    }
    if (willExceedStorage) {
      setFeedback({
        type: 'error',
        message: `Espacio de almacén insuficiente: solo puedes recibir ${Math.floor(spaceAvailable)} de ${MARKET_RESOURCE_NAMES[toResource]}.`,
      });
      return;
    }

    setActionLoading(true);
    setFeedback(null);

    try {
      const idempotencyKey = `trade-${kingdomId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await executeExchange({
        kingdomId,
        idempotencyKey,
        fromResource,
        toResource,
        fromAmount: inputAmount,
      });

      if (result.success) {
        setFeedback({
          type: 'success',
          message: result.message || 'Intercambio comercial realizado con éxito.',
        });
      }
    } catch (err: any) {
      const msg = err.data || err.message || 'Error desconocido al ejecutar el intercambio.';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-5 shadow-sm space-y-5">
      {/* Encabezado del Mercado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#241e15] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded bg-[#1e1811] border border-[#3d3221] text-[#d4af37]">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">
                Mercado del Reino
              </h2>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold border ${
                  isUnlocked
                    ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50'
                    : 'text-amber-400 bg-amber-950/40 border-amber-800/50'
                }`}
              >
                {isUnlocked ? `Nivel ${mercadoLevel} (Desbloqueado)` : `Nivel ${mercadoLevel} / 4 (Bloqueado)`}
              </span>
            </div>
            <p className="text-[11px] text-[#8e816d] mt-0.5">
              Intercambio comercial interno entre los cinco recursos del reino con conservación estricta de valor.
            </p>
          </div>
        </div>

        <div className="text-right text-[11px] text-[#736754] font-mono">
          Tope almacén: <span className="text-[#d4af37] font-semibold">{effectiveCapacity.toLocaleString('es-ES')}</span>
        </div>
      </div>

      {/* BLOQUE DE BLOQUEO SI MERCADO < 4 */}
      {!isUnlocked ? (
        <div className="bg-[#18130d] border border-amber-800/50 rounded-lg p-5 text-center space-y-3">
          <div className="inline-flex items-center justify-center p-3 rounded-full bg-amber-950/40 border border-amber-700/40 text-amber-300">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-serif font-bold text-sm text-[#f5efe1]">
              Intercambio Comercial Bloqueado
            </h3>
            <p className="text-xs text-amber-300 font-medium">
              «Mejora el Mercado al nivel 4 para desbloquear el intercambio de recursos».
            </p>
            <p className="text-[11px] text-[#8e816d] max-w-md mx-auto pt-1">
              Actualmente tu Mercado está a nivel <span className="font-bold text-[#e6ded0]">{mercadoLevel}</span>.
              Al alcanzar el nivel 4, tus mercaderes podrán convertir excedentes de producción en los recursos que más necesites.
            </p>
          </div>
        </div>
      ) : (
        /* INTERFAZ ACTIVA DE INTERCAMBIO */
        <div className="space-y-5">
          {/* Fila 1: Selección de recursos (Entregar vs Recibir) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Recurso que se entrega */}
            <div className="bg-[#100d0a] border border-[#261f15] rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#f5efe1] flex items-center gap-1.5">
                  <span className="text-red-400 font-bold">1.</span> Recurso a entregar:
                </span>
                <span className="text-[11px] text-[#8e816d]">
                  Disponible: <strong className="text-[#e6ded0] font-mono">{Math.floor(currentFrom).toLocaleString('es-ES')}</strong>
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {VALID_MARKET_RESOURCES.map((res) => {
                  const isSelected = fromResource === res;
                  const balance = resources ? resources[res] : 0;
                  return (
                    <button
                      key={res}
                      type="button"
                      onClick={() => handleSelectFrom(res)}
                      className={`p-2 rounded text-center transition-all flex flex-col items-center gap-1 border ${
                        isSelected
                          ? 'bg-[#2b2114] border-[#d4af37] shadow-sm'
                          : 'bg-[#15120e] border-[#2c2419] hover:border-[#4d3d28]'
                      }`}
                    >
                      <span className="text-lg leading-none">{MARKET_RESOURCE_EMOJIS[res]}</span>
                      <span className="text-[10px] font-bold text-[#e6ded0]">{MARKET_RESOURCE_NAMES[res]}</span>
                      <span className="text-[9px] font-mono text-[#8e816d] truncate w-full">
                        {Math.floor(balance).toLocaleString('es-ES')}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] text-[#736754] flex items-center justify-between pt-1">
                <span>Valor unitario: <strong>{RESOURCE_COMMERCIAL_VALUES[fromResource]} pts</strong></span>
                <span>Lote mínimo: <strong>{batchInfo.minFromBatch} {MARKET_RESOURCE_NAMES[fromResource]}</strong></span>
              </div>
            </div>

            {/* Recurso que se recibe */}
            <div className="bg-[#100d0a] border border-[#261f15] rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#f5efe1] flex items-center gap-1.5">
                  <span className="text-emerald-400 font-bold">2.</span> Recurso a recibir:
                </span>
                <span className="text-[11px] text-[#8e816d]">
                  Espacio libre: <strong className="text-emerald-300 font-mono">{Math.floor(spaceAvailable).toLocaleString('es-ES')}</strong>
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {VALID_MARKET_RESOURCES.map((res) => {
                  const isSelected = toResource === res;
                  const isOrigin = fromResource === res;
                  const balance = resources ? resources[res] : 0;
                  return (
                    <button
                      key={res}
                      type="button"
                      disabled={isOrigin}
                      onClick={() => handleSelectTo(res)}
                      className={`p-2 rounded text-center transition-all flex flex-col items-center gap-1 border ${
                        isOrigin
                          ? 'opacity-30 cursor-not-allowed bg-[#0d0b08] border-[#1d1710]'
                          : isSelected
                            ? 'bg-[#172517] border-emerald-500 shadow-sm'
                            : 'bg-[#15120e] border-[#2c2419] hover:border-[#4d3d28]'
                      }`}
                    >
                      <span className="text-lg leading-none">{MARKET_RESOURCE_EMOJIS[res]}</span>
                      <span className="text-[10px] font-bold text-[#e6ded0]">{MARKET_RESOURCE_NAMES[res]}</span>
                      <span className="text-[9px] font-mono text-[#8e816d] truncate w-full">
                        {Math.floor(balance).toLocaleString('es-ES')}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="text-[10px] text-[#736754] flex items-center justify-between pt-1">
                <span>Valor unitario: <strong>{RESOURCE_COMMERCIAL_VALUES[toResource]} pts</strong></span>
                <span>Recibido por lote: <strong>{batchInfo.minToBatch} {MARKET_RESOURCE_NAMES[toResource]}</strong></span>
              </div>
            </div>
          </div>

          {/* Fila 2: Cantidad y regla de lotes */}
          <div className="bg-[#100d0a] border border-[#261f15] rounded-lg p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-[#f5efe1]">
                <span className="text-amber-400 font-bold">3.</span> Cantidad de {MARKET_RESOURCE_NAMES[fromResource]} a entregar:
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSetPreset(1)}
                  className="px-2 py-0.5 rounded bg-[#1c1711] border border-[#382d1e] text-[10px] text-[#d4af37] hover:bg-[#251f16]"
                >
                  +{batchInfo.minFromBatch} (1 Lote)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset(5)}
                  className="px-2 py-0.5 rounded bg-[#1c1711] border border-[#382d1e] text-[10px] text-[#d4af37] hover:bg-[#251f16]"
                >
                  +{batchInfo.minFromBatch * 5} (5 Lotes)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetPreset(10)}
                  className="px-2 py-0.5 rounded bg-[#1c1711] border border-[#382d1e] text-[10px] text-[#d4af37] hover:bg-[#251f16]"
                >
                  +{batchInfo.minFromBatch * 10} (10 Lotes)
                </button>
                <button
                  type="button"
                  onClick={handleSetMax}
                  className="px-2 py-0.5 rounded bg-[#2b2114] border border-[#d4af37]/60 text-[10px] font-bold text-amber-300 hover:bg-[#382c1a]"
                >
                  Máximo
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="number"
                  min={batchInfo.minFromBatch}
                  step={batchInfo.minFromBatch}
                  value={amountStr}
                  onChange={(e) => {
                    setAmountStr(e.target.value);
                    setFeedback(null);
                  }}
                  className="w-full bg-[#16120d] border border-[#3a2f20] rounded px-3 py-2 text-sm font-mono text-[#f5efe1] focus:outline-none focus:border-[#d4af37]"
                  placeholder={`Múltiplo de ${batchInfo.minFromBatch}`}
                />
                <span className="absolute right-3 top-2.5 text-xs text-[#8e816d]">
                  {MARKET_RESOURCE_NAMES[fromResource]}
                </span>
              </div>

              <div className="flex items-center justify-center p-2 rounded bg-[#18130d] border border-[#2e2417] text-[#8e816d]">
                <ArrowRightLeft className="w-5 h-5 text-[#d4af37]" />
              </div>

              <div className="flex-1 bg-[#16120d] border border-[#3a2f20] rounded px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-[#8e816d]">Recibirás:</span>
                <span className="text-sm font-mono font-bold text-emerald-400">
                  {exchangeCalc.valid ? `+${exchangeCalc.toAmount.toLocaleString('es-ES')}` : '0'} {MARKET_RESOURCE_NAMES[toResource]}
                </span>
              </div>
            </div>

            {/* Equivalencia aplicada y lote mínimo */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[#8e816d] bg-[#14100c] p-2 rounded border border-[#241c13]">
              <span className="flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>
                  Equivalencia exacta: <strong className="text-[#e6ded0]">{batchInfo.minFromBatch} {MARKET_RESOURCE_NAMES[fromResource]}</strong> = <strong className="text-emerald-400">{batchInfo.minToBatch} {MARKET_RESOURCE_NAMES[toResource]}</strong>
                </span>
              </span>
              <span>
                Tasa: 1 {MARKET_RESOURCE_NAMES[fromResource]} ≈ <strong className="text-[#e6ded0] font-mono">{batchInfo.rateRatio >= 1 ? batchInfo.rateRatio.toFixed(2) : (1 / batchInfo.rateRatio).toFixed(2) + '⁻¹'}</strong> {MARKET_RESOURCE_NAMES[toResource]}
              </span>
            </div>
          </div>

          {/* Fila 3: Resumen previo y botón de confirmación */}
          <div className="bg-[#100d0a] border border-[#261f15] rounded-lg p-3.5 space-y-3">
            <h4 className="text-xs font-serif font-bold text-[#f5efe1] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#d4af37]" />
              <span>Resumen de la Transacción Comercial</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-[#15110d] p-2 rounded border border-[#261f15]">
                <span className="text-[10px] text-[#8e816d] block">Entregas:</span>
                <span className="font-mono font-bold text-red-400">
                  -{inputAmount} {MARKET_RESOURCE_NAMES[fromResource]}
                </span>
                <span className="text-[9px] text-[#736754] block mt-0.5 font-mono">
                  Quedarán: {Math.max(0, currentFrom - inputAmount).toLocaleString('es-ES')}
                </span>
              </div>

              <div className="bg-[#15110d] p-2 rounded border border-[#261f15]">
                <span className="text-[10px] text-[#8e816d] block">Recibes:</span>
                <span className="font-mono font-bold text-emerald-400">
                  +{exchangeCalc.toAmount} {MARKET_RESOURCE_NAMES[toResource]}
                </span>
                <span className="text-[9px] text-[#736754] block mt-0.5 font-mono">
                  Tendrás: {(currentTo + exchangeCalc.toAmount).toLocaleString('es-ES')}
                </span>
              </div>

              <div className="bg-[#15110d] p-2 rounded border border-[#261f15]">
                <span className="text-[10px] text-[#8e816d] block">Almacén destino tras cambio:</span>
                <span
                  className={`font-mono font-bold ${
                    willExceedStorage ? 'text-red-400' : 'text-[#d4af37]'
                  }`}
                >
                  {(currentTo + exchangeCalc.toAmount).toLocaleString('es-ES')} / {effectiveCapacity.toLocaleString('es-ES')}
                </span>
                <span className="text-[9px] text-[#736754] block mt-0.5">
                  {willExceedStorage ? '¡Desborda almacén!' : `Libre: ${(spaceAvailable - exchangeCalc.toAmount).toLocaleString('es-ES')}`}
                </span>
              </div>

              <div className="bg-[#15110d] p-2 rounded border border-[#261f15]">
                <span className="text-[10px] text-[#8e816d] block">Valor económico:</span>
                <span className="font-mono font-bold text-[#f5efe1]">
                  {exchangeCalc.valueDelivered} = {exchangeCalc.valueReceived} pts
                </span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">
                  100% conservado
                </span>
              </div>
            </div>

            {/* Mensajes de validación o retroalimentación */}
            {feedback && (
              <div
                className={`p-2.5 rounded text-xs flex items-center gap-2 border ${
                  feedback.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : 'bg-red-950/40 border-red-800/60 text-red-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            {/* Botón de Confirmación */}
            <button
              type="button"
              disabled={
                !isOwner ||
                actionLoading ||
                !exchangeCalc.valid ||
                !hasEnoughFrom ||
                willExceedStorage
              }
              onClick={handleExecuteTrade}
              className={`w-full py-2.5 px-4 rounded font-serif font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 border ${
                !isOwner || !exchangeCalc.valid || !hasEnoughFrom || willExceedStorage
                  ? 'bg-[#18130d] border-[#2c2419] text-[#6d6251] cursor-not-allowed'
                  : 'bg-[#2b2114] border-[#d4af37] text-[#f5efe1] hover:bg-[#382b1a] shadow-md cursor-pointer'
              }`}
            >
              {actionLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#d4af37]" />
                  <span>Procesando intercambio en Convex...</span>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4 text-[#d4af37]" />
                  <span>Confirmar Intercambio de Recursos</span>
                </>
              )}
            </button>
          </div>

          {/* Fila 4: Historial reciente de intercambios (Requisito 8) */}
          {marketData?.recentTrades && marketData.recentTrades.length > 0 && (
            <div className="bg-[#100d0a] border border-[#261f15] rounded-lg p-3.5 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs text-[#8e816d] border-b border-[#221c13] pb-2">
                <History className="w-3.5 h-3.5 text-[#d4af37]" />
                <h4 className="font-serif font-bold text-[#e6ded0] uppercase tracking-wider text-[11px]">
                  Últimos Intercambios Realizados
                </h4>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {marketData.recentTrades.map((trade: any) => {
                  const fromEmoji = MARKET_RESOURCE_EMOJIS[trade.fromResource as MarketResourceType] || '📦';
                  const toEmoji = MARKET_RESOURCE_EMOJIS[trade.toResource as MarketResourceType] || '📦';
                  const dateStr = new Date(trade.createdAt).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <div
                      key={trade._id}
                      className="bg-[#14100c] border border-[#221c14] rounded p-2 text-[11px] flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[#736754] text-[10px]">{dateStr}</span>
                        <span className="text-red-400 font-mono font-semibold">
                          -{trade.fromAmount} {fromEmoji} {MARKET_RESOURCE_NAMES[trade.fromResource as MarketResourceType] || trade.fromResource}
                        </span>
                        <span className="text-[#736754]">➔</span>
                        <span className="text-emerald-400 font-mono font-semibold">
                          +{trade.toAmount} {toEmoji} {MARKET_RESOURCE_NAMES[trade.toResource as MarketResourceType] || trade.toResource}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-[#5a5041]">
                        {trade.idempotencyKey.slice(0, 14)}...
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
