import React, { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useMutation } from 'convex/react';
import { makeFunctionReference } from 'convex/server';

const resetKingdomMutation = makeFunctionReference<"mutation">("kingdoms:resetKingdom");

export function ResetKingdomConfirmation(props: { kingdomId: string; onReset: () => void }) {
  const resetKingdom = useMutation(resetKingdomMutation);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState('');

  const handleReset = async () => {
    if (confirmationText !== 'REINICIAR') return;
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
        className="text-red-400 hover:text-red-300 text-xs font-serif underline"
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
          <h3 className="font-serif font-bold text-lg">¿Reiniciar partida desde cero?</h3>
        </div>
        <p className="text-xs text-[#e6ded0]">
          Vas a reiniciar tu partida desde cero. Se eliminará tu reino actual y todo el progreso asociado. Esta acción es <strong>irreversible</strong>.
        </p>
        <p className="text-xs text-[#e6ded0]">
          Tu cuenta, nombre de usuario, contraseña y clave de recuperación se conservarán. Después del reinicio podrás fundar un nuevo reino con las condiciones iniciales.
        </p>
        <p className="text-xs text-[#e6ded0] pt-2">
          Escribe "REINICIAR" para confirmar:
        </p>
        <input 
          type="text" 
          value={confirmationText} 
          onChange={(e) => setConfirmationText(e.target.value)}
          className="w-full bg-[#090e17] border border-[#3b3121] rounded p-2 text-sm text-white"
          placeholder="REINICIAR"
        />
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
            className="flex-1 px-4 py-2 bg-red-900/60 text-white rounded hover:bg-red-800 disabled:opacity-50"
            disabled={submitting || confirmationText !== 'REINICIAR'}
          >
            {submitting ? <Loader2 className="animate-spin w-4 h-4 mx-auto" /> : 'CONFIRMAR REINICIO'}
          </button>
        </div>
      </div>
    </div>
  );
}
