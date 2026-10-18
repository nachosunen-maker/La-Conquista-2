import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useMutation } from 'convex/react';
import { makeFunctionReference } from 'convex/server';

const resetKingdomMutation = makeFunctionReference<"mutation">("economy:resetKingdom");

export function ResetKingdomConfirmation(props: { kingdomId: string; onReset: () => void }) {
  const resetKingdom = useMutation(resetKingdomMutation);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await resetKingdom({ kingdomId: props.kingdomId as any });
      props.onReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reiniciar el reino.');
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!confirming) {
    return (
      <button 
        onClick={() => setConfirming(true)}
        className="text-red-400 hover:text-red-300 text-sm font-serif underline"
      >
        Reiniciar partida
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-[#14120e] border border-red-900/60 rounded-xl p-6 max-w-sm space-y-4 shadow-2xl">
        <div className="flex items-center gap-3 text-red-500">
          <AlertTriangle className="w-8 h-8" />
          <h3 className="font-serif font-bold text-lg">¿Reiniciar partida?</h3>
        </div>
        <p className="text-sm text-[#e6ded0]">
          Esta acción es <strong className="text-red-400">irreversible</strong>. Perderás todos tus recursos, edificios, ejército y tecnologías.
        </p>
        <p className="text-sm text-[#e6ded0]">
          ¿Estás <strong className="text-red-400">seguro</strong> de que quieres borrar todo y fundar un nuevo reino?
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-2">
          <button 
            onClick={() => setConfirming(false)}
            className="flex-1 px-4 py-2 bg-[#2b2419] text-[#e6ded0] rounded hover:bg-[#3d3324]"
            disabled={submitting}
          >
            Cancelar
          </button>
          <button 
            onClick={handleReset}
            className="flex-1 px-4 py-2 bg-red-900/60 text-white rounded hover:bg-red-800"
            disabled={submitting}
          >
            {submitting ? <Loader2 className="animate-spin w-4 h-4 mx-auto" /> : 'SÍ, REINICIAR'}
          </button>
        </div>
      </div>
    </div>
  );
}
