import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Castle, Crown, Loader2, AlertCircle } from 'lucide-react';
import { CIVILIZATIONS } from '../../convex/balanceConfig';
import { inputClass } from './shared';

const listCivilizationsQuery = makeFunctionReference<"query">("civilizations:listCivilizations");
const getOrInitializeKingdomMutation = makeFunctionReference<"mutation">("economy:getOrInitializeKingdom");

type Step = 'origen' | 'reino' | 'castillo' | 'monarca' | 'confirmar';
const STEPS: Step[] = ['origen', 'reino', 'castillo', 'monarca', 'confirmar'];

/**
 * Asistente de creación del reino (P4-P9): origen, nombre del reino, nombre del
 * castillo, nombre del monarca y confirmación con "FUNDAR MI REINO".
 */
export function FoundingWizard(props: { defaultMonarchName: string; onFounded: () => void; disabled?: boolean }) {
  const civilizationsData = useQuery(listCivilizationsQuery) as
    | { civilizations: ReadonlyArray<{ id: string; label: string }>; profiles?: ReadonlyArray<{ id: string; advantage: string; weakness: string | null; identity: { signatureUnit: { name: string }; uniqueBuilding: { name: string } } | null }>; bonusesEnabled: boolean; immutable: boolean }
    | undefined;
  const civilizations = civilizationsData?.civilizations ?? CIVILIZATIONS;
  const found = useMutation(getOrInitializeKingdomMutation);

  const [step, setStep] = useState<Step>('origen');
  const [civilization, setCivilization] = useState<string>('');
  const [kingdomName, setKingdomName] = useState<string>('');
  const [castleName, setCastleName] = useState<string>('');
  const [monarchName, setMonarchName] = useState<string>(props.defaultMonarchName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  const back = () => setStep(STEPS[Math.max(0, stepIndex - 1)]);

  const canContinue =
    (step === 'origen' && civilization !== '') ||
    (step === 'reino' && kingdomName.trim().length > 0) ||
    (step === 'castillo' && castleName.trim().length > 0) ||
    (step === 'monarca' && monarchName.trim().length > 0) ||
    step === 'confirmar';

  const handleFound = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await found({
        name: kingdomName.trim(),
        civilization,
        castleName: castleName.trim(),
        monarchName: monarchName.trim(),
      });
      props.onFounded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo fundar el reino.');
    } finally {
      setSubmitting(false);
    }
  };

  const civilizationLabel = civilizations.find((c) => c.id === civilization)?.label ?? civilization;

  return (
    <div className="bg-[#14120e] border border-amber-900/40 rounded-xl p-6 sm:p-8 max-w-2xl mx-auto my-8 space-y-6 shadow-2xl">
      <div className="text-center space-y-2">
        <Castle className="w-12 h-12 text-[#d4af37] mx-auto opacity-90" />
        <h2 className="text-xl font-serif font-bold text-[#f4eedb]">Creación del reino</h2>
        <p className="text-xs text-[#8e816d]">Gobierna. Entrena. Negocia. Conquista.</p>
        <ol className="flex flex-wrap justify-center gap-1.5 pt-2" aria-label="Pasos">
          {STEPS.map((s, index) => (
            <li
              key={s}
              className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                index === stepIndex
                  ? 'border-[#d4af37] text-[#d4af37] bg-[#241a10]'
                  : index < stepIndex
                    ? 'border-emerald-800/60 text-emerald-400'
                    : 'border-[#2b2419] text-[#6b604e]'
              }`}
            >
              {index + 1}. {s === 'origen' ? 'Origen' : s === 'reino' ? 'Reino' : s === 'castillo' ? 'Castillo' : s === 'monarca' ? 'Monarca' : 'Confirmación'}
            </li>
          ))}
        </ol>
      </div>

      {step === 'origen' && (
        <div className="space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#e6ded0]">Elige el origen de tu reino</h3>
          <p className="text-[11px] text-[#8e816d]">
            Doce civilizaciones. La elección es definitiva al fundar el reino.
            {civilizationsData && !civilizationsData.bonusesEnabled && ' Las bonificaciones por civilización están temporalmente inactivas.'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {civilizations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCivilization(c.id)}
                className={`px-3 py-2 rounded-lg border text-xs font-serif transition-colors ${
                  civilization === c.id
                    ? 'bg-[#d4af37] text-neutral-950 border-[#d4af37] font-semibold'
                    : 'bg-[#1b1610] text-[#e6ded0] border-[#362b1c] hover:border-[#d4af37]/50'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {civilization && (() => {
            const profile = civilizationsData?.profiles?.find((p) => p.id === civilization);
            if (!profile) return null;
            return (
              <div className="rounded border border-[#2b2419] bg-[#100e0b] p-2.5 text-[11px] text-[#c7beac] space-y-1">
                <p><strong className="text-emerald-200">Ventaja:</strong> {profile.advantage}</p>
                <p><strong className="text-rose-200">Desafío:</strong> {profile.weakness ?? 'Ninguno destacado'}</p>
                {profile.identity && <p><strong className="text-[#e6ded0]">Tropa y edificio propios:</strong> {profile.identity.signatureUnit.name} · {profile.identity.uniqueBuilding.name}</p>}
              </div>
            );
          })()}
        </div>
      )}

      {step === 'reino' && (
        <div className="space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#e6ded0]">Nombra tu reino</h3>
          <p className="text-[11px] text-[#8e816d]">Ejemplo: Reino de Iberia. El nombre queda asociado permanentemente a la partida.</p>
          <input
            className={`${inputClass} w-full text-sm py-2`}
            value={kingdomName}
            maxLength={60}
            onChange={(e) => setKingdomName(e.target.value)}
            placeholder="Reino de…"
            autoFocus
          />
        </div>
      )}

      {step === 'castillo' && (
        <div className="space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#e6ded0]">Nombra tu castillo</h3>
          <p className="text-[11px] text-[#8e816d]">Ejemplo: Castillo de Zaragoza. El castillo es el centro administrativo del reino.</p>
          <input
            className={`${inputClass} w-full text-sm py-2`}
            value={castleName}
            maxLength={60}
            onChange={(e) => setCastleName(e.target.value)}
            placeholder="Castillo de…"
            autoFocus
          />
        </div>
      )}

      {step === 'monarca' && (
        <div className="space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#e6ded0]">Nombre del monarca</h3>
          <p className="text-[11px] text-[#8e816d]">Así te conocerán los demás reinos.</p>
          <input
            className={`${inputClass} w-full text-sm py-2`}
            value={monarchName}
            maxLength={60}
            onChange={(e) => setMonarchName(e.target.value)}
            placeholder="Nombre del monarca"
            autoFocus
          />
        </div>
      )}

      {step === 'confirmar' && (
        <div className="space-y-3">
          <h3 className="text-sm font-serif font-semibold text-[#e6ded0] text-center">Tu reino está preparado</h3>
          <dl className="grid grid-cols-2 gap-2 text-xs bg-[#19150f] border border-[#2c2419] rounded-lg p-4">
            <dt className="text-[#8e816d]">Monarca</dt><dd className="text-[#f0e8d4] font-medium">{monarchName}</dd>
            <dt className="text-[#8e816d]">Reino</dt><dd className="text-[#f0e8d4] font-medium">{kingdomName}</dd>
            <dt className="text-[#8e816d]">Castillo</dt><dd className="text-[#f0e8d4] font-medium">{castleName}</dd>
            <dt className="text-[#8e816d]">Civilización</dt><dd className="text-[#f0e8d4] font-medium">{civilizationLabel}</dd>
          </dl>
          <p className="text-[11px] text-[#8e816d] text-center">
            Al fundar, el servidor crea el reino con su población inicial, los edificios fundacionales y un territorio principal en el mapa.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-400 flex items-center gap-1.5 justify-center">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={back}
          disabled={stepIndex === 0 || submitting}
          className="px-4 py-2 rounded border border-[#3b3121] text-[#a0937e] text-xs hover:text-[#e8dfc8] disabled:opacity-40"
        >
          Atrás
        </button>
        {step !== 'confirmar' ? (
          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            className="px-5 py-2 rounded-lg bg-[#2d2214] hover:bg-[#3d2f1b] border border-[#d4af37]/50 text-[#d4af37] text-xs font-serif font-semibold uppercase tracking-wider disabled:opacity-40"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFound}
            disabled={submitting || props.disabled}
            className="px-5 py-2.5 rounded-lg bg-[#d4af37] hover:bg-[#e0bd4a] text-neutral-950 text-xs font-serif font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            {props.disabled ? 'Inicia sesión para fundar' : 'Fundar mi reino'}
          </button>
        )}
      </div>
    </div>
  );
}
