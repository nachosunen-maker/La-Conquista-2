import React, { useState } from 'react';
import { Crown, Castle, Shield, Users, Wheat, Coins, CheckCircle2, AlertCircle, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { CIVILIZATIONS } from '../../convex/balanceConfig';

interface KingdomCreationWizardProps {
  defaultMonarchName?: string;
  userEmail?: string;
  onSubmit: (data: {
    civilization: string;
    kingdomName: string;
    castleName: string;
    monarchName: string;
  }) => Promise<void>;
  onCancel?: () => void;
}

export function KingdomCreationWizard({
  defaultMonarchName = '',
  userEmail = '',
  onSubmit,
  onCancel,
}: KingdomCreationWizardProps) {
  // Pasos: 1 = Civilización (P6), 2 = Nombres (P7/P8), 3 = Confirmación (P9)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [selectedCiv, setSelectedCiv] = useState<string>('ingleses');
  const [kingdomName, setKingdomName] = useState<string>('');
  const [castleName, setCastleName] = useState<string>('');
  const [monarchName, setMonarchName] = useState<string>(defaultMonarchName || 'Soberano');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeCiv = CIVILIZATIONS.find((c: any) => c.id === selectedCiv) || CIVILIZATIONS[0];

  const handleNextFromStep1 = () => {
    setErrorMessage(null);
    if (!selectedCiv) {
      setErrorMessage('Por favor, selecciona una civilización de origen.');
      return;
    }
    setStep(2);
  };

  const handleNextFromStep2 = () => {
    setErrorMessage(null);
    const cleanK = kingdomName.trim();
    const cleanC = castleName.trim();
    const cleanM = monarchName.trim();

    if (cleanK.length < 3 || cleanK.length > 40) {
      setErrorMessage('El nombre del reino debe contener entre 3 y 40 caracteres.');
      return;
    }
    if (cleanK.toLowerCase() === 'iberia' || cleanK.toLowerCase() === 'reino de iberia') {
      setErrorMessage("El nombre 'Iberia' está reservado exclusivamente para el reino de demostración.");
      return;
    }
    if (cleanC.length < 3 || cleanC.length > 40) {
      setErrorMessage('El nombre del castillo debe contener entre 3 y 40 caracteres.');
      return;
    }
    if (cleanM.length < 2 || cleanM.length > 40) {
      setErrorMessage('El nombre del monarca debe contener entre 2 y 40 caracteres.');
      return;
    }
    setStep(3);
  };

  const handleFinalSubmit = async () => {
    if (isSubmitting) return; // Salvaguarda anti doble pulsación
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onSubmit({
        civilization: selectedCiv,
        kingdomName: kingdomName.trim(),
        castleName: castleName.trim(),
        monarchName: monarchName.trim(),
      });
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al fundar el reino en el servidor.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#14120e] border border-[#3b3020] rounded-xl p-5 sm:p-8 max-w-3xl mx-auto shadow-2xl space-y-6">
      {/* Encabezado del Asistente */}
      <div className="border-b border-[#2d2419] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#241c12] border border-[#d4af37]/40 rounded-lg text-[#d4af37]">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-[#f4eedb]">
              Fundación de Reino (Puntos 5–10)
            </h2>
            <p className="text-xs text-[#8e816d]">
              Establece los cimientos permanentes de tu reino medieval en el servidor.
            </p>
          </div>
        </div>

        {/* Indicador de pasos */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-serif font-semibold">
          <span className={`px-2.5 py-1 rounded border ${step === 1 ? 'bg-[#291e12] border-[#d4af37] text-[#d4af37]' : 'bg-[#18140f] border-[#31271b] text-[#6b6051]'}`}>
            1. Civilización
          </span>
          <span className="text-[#453724]">→</span>
          <span className={`px-2.5 py-1 rounded border ${step === 2 ? 'bg-[#291e12] border-[#d4af37] text-[#d4af37]' : 'bg-[#18140f] border-[#31271b] text-[#6b6051]'}`}>
            2. Nombres
          </span>
          <span className="text-[#453724]">→</span>
          <span className={`px-2.5 py-1 rounded border ${step === 3 ? 'bg-[#291e12] border-[#d4af37] text-[#d4af37]' : 'bg-[#18140f] border-[#31271b] text-[#6b6051]'}`}>
            3. Fundación
          </span>
        </div>
      </div>

      {/* Mensaje de error si ocurre */}
      {errorMessage && (
        <div className="p-3.5 bg-rose-950/40 border border-rose-900 rounded-lg text-xs text-rose-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Aviso de Fundación</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* ====================================================================
          PASO 1: SELECCIÓN DE CIVILIZACIÓN (PUNTO 6)
          ==================================================================== */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-serif font-bold text-[#e6ded0] uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#d4af37]" />
              <span>Elige el origen de tu reino (P6)</span>
            </h3>
            <p className="text-xs text-[#8e816d]">
              Selecciona una de las 12 civilizaciones oficiales. Esta elección quedará vinculada permanentemente a tu partida.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {CIVILIZATIONS.map((civ: any) => {
              const isSelected = selectedCiv === civ.id;
              return (
                <div
                  key={civ.id}
                  onClick={() => setSelectedCiv(civ.id)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer text-left space-y-1 ${
                    isSelected
                      ? 'bg-[#291d11] border-[#d4af37] shadow-md shadow-[#d4af37]/15 ring-1 ring-[#d4af37]'
                      : 'bg-[#18140f] border-[#2f2519] hover:border-[#4d3d29] hover:bg-[#1f1913]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xl" role="img" aria-label={civ.label}>
                      🛡️
                    </span>
                    {isSelected && (
                      <span className="text-[10px] text-[#d4af37] font-bold">✓ Seleccionada</span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-serif font-bold text-[#f4eedb]">
                      {civ.label}
                    </h4>
                    <p className="text-[10px] text-[#938673] line-clamp-2 leading-tight pt-0.5">
                      Civilización oficial (P6 / D-43)
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {activeCiv && (
            <div className="p-3 bg-[#1c1610] border border-[#3f311e] rounded-lg text-xs text-[#c5b7a0] flex items-center justify-between">
              <div>
                <span className="font-serif font-semibold text-[#f4eedb]">{activeCiv.label}</span>: Civilización elegida (P6)
              </div>
              <span className="text-[10px] text-[#d4af37] font-mono whitespace-nowrap">Estilo balanceado</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2.5">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 bg-[#18140f] hover:bg-[#221c15] border border-[#3a2e1e] rounded text-xs text-[#9d8f7b] font-serif transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={handleNextFromStep1}
              className="px-5 py-2 bg-[#2d2012] hover:bg-[#3d2c18] border border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Continuar a Nombres</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#d4af37]" />
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          PASO 2: NOMBRES DEL REINO Y CASTILLO (PUNTOS 7 Y 8)
          ==================================================================== */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-serif font-bold text-[#e6ded0] uppercase tracking-wider flex items-center gap-2">
              <Castle className="w-4 h-4 text-[#d4af37]" />
              <span>Nombra tu reino y tu castillo (P7 y P8)</span>
            </h3>
            <p className="text-xs text-[#8e816d]">
              El nombre del reino y de tu fortaleza capital quedarán fijados de forma permanente.
            </p>
          </div>

          <div className="space-y-3.5 bg-[#17130e] p-4 rounded-lg border border-[#2b2216]">
            <div>
              <label className="block text-xs font-serif font-semibold text-[#f4eedb] mb-1">
                Nombre del Reino (P7) <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={kingdomName}
                onChange={(e) => setKingdomName(e.target.value)}
                placeholder="Ejemplo: Reino de Castilla, Reino de Grecia, etc."
                maxLength={40}
                className="w-full px-3 py-2 bg-[#100d09] border border-[#3c301f] focus:border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif outline-none"
              />
              <span className="text-[10px] text-[#786c5a] mt-0.5 block">
                Entre 3 y 40 caracteres. Asociado permanentemente a tu partida.
              </span>
            </div>

            <div>
              <label className="block text-xs font-serif font-semibold text-[#f4eedb] mb-1">
                Nombre del Castillo Capital (P8) <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={castleName}
                onChange={(e) => setCastleName(e.target.value)}
                placeholder="Ejemplo: Castillo de Zaragoza, Fortaleza Real, etc."
                maxLength={40}
                className="w-full px-3 py-2 bg-[#100d09] border border-[#3c301f] focus:border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif outline-none"
              />
              <span className="text-[10px] text-[#786c5a] mt-0.5 block">
                Centro administrativo inicial del reino (Edificio Nivel 1).
              </span>
            </div>

            <div>
              <label className="block text-xs font-serif font-semibold text-[#f4eedb] mb-1">
                Nombre del Monarca (P5)
              </label>
              <input
                type="text"
                value={monarchName}
                onChange={(e) => setMonarchName(e.target.value)}
                placeholder="Nombre de Soberano"
                maxLength={40}
                className="w-full px-3 py-2 bg-[#100d09] border border-[#3c301f] focus:border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif outline-none"
              />
              <span className="text-[10px] text-[#786c5a] mt-0.5 block">
                Cuenta asociada: <span className="font-mono text-[#c5b7a0]">{userEmail}</span>
              </span>
            </div>
          </div>

          <div className="pt-2 flex justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-[#18140f] hover:bg-[#221c15] border border-[#3a2e1e] rounded text-xs text-[#9d8f7b] font-serif flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver</span>
            </button>
            <button
              type="button"
              onClick={handleNextFromStep2}
              className="px-5 py-2 bg-[#2d2012] hover:bg-[#3d2c18] border border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Revisar y Confirmar</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#d4af37]" />
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          PASO 3: CONFIRMACIÓN Y FUNDACIÓN (PUNTOS 9 Y 10)
          ==================================================================== */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-serif font-bold text-[#e6ded0] uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Tu reino está preparado (Punto 9)</span>
            </h3>
            <p className="text-xs text-[#8e816d]">
              Revisa los estatutos fundacionales. Al confirmar, se creará tu partida autoritativa en el servidor.
            </p>
          </div>

          {/* Tarjeta de Resumen Oficial */}
          <div className="bg-[#17130e] border border-[#3a2e1e] rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pb-2 border-b border-[#292015] text-xs">
              <div>
                <span className="text-[10px] text-[#7d705e] uppercase block font-semibold">Civilización</span>
                <span className="font-serif font-bold text-[#f4eedb] flex items-center gap-1">
                  <span>🛡️</span>
                  <span>{activeCiv.label}</span>
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#7d705e] uppercase block font-semibold">Reino</span>
                <span className="font-serif font-bold text-[#d4af37] truncate block" title={kingdomName}>
                  {kingdomName}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#7d705e] uppercase block font-semibold">Castillo</span>
                <span className="font-serif font-bold text-[#f4eedb] truncate block" title={castleName}>
                  {castleName}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#7d705e] uppercase block font-semibold">Monarca</span>
                <span className="font-serif font-bold text-[#f4eedb] truncate block" title={monarchName}>
                  {monarchName}
                </span>
              </div>
            </div>

            {/* Garantías Oficiales Iniciales */}
            <div className="space-y-1.5 pt-1 text-xs">
              <span className="text-[11px] font-serif font-semibold text-[#c7ba9f] uppercase tracking-wider block">
                Estatutos y Asignación Inicial Canónica:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#8e816d]">
                <div className="flex items-center gap-2 bg-[#120f0b] p-2 rounded border border-[#261e14]">
                  <Users className="w-3.5 h-3.5 text-[#d4af37]" />
                  <span>Censo inicial oficial: <b className="text-[#f4eedb]">2.000 habitantes</b> (P10)</span>
                </div>
                <div className="flex items-center gap-2 bg-[#120f0b] p-2 rounded border border-[#261e14]">
                  <Castle className="w-3.5 h-3.5 text-[#d4af37]" />
                  <span>Fortaleza capital: <b className="text-[#f4eedb]">Castillo Nivel 1</b> (P8)</span>
                </div>
                <div className="flex items-center gap-2 bg-[#120f0b] p-2 rounded border border-[#261e14]">
                  <Wheat className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Oficios: <b className="text-[#f4eedb]">1.750 trabajadores + 250 libres</b> (P12)</span>
                </div>
                <div className="flex items-center gap-2 bg-[#120f0b] p-2 rounded border border-[#261e14]">
                  <Coins className="w-3.5 h-3.5 text-amber-400" />
                  <span>Dotación: <b className="text-[#f4eedb]">500 oro, 2500 comida, recursos base</b></span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-between gap-2.5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-[#18140f] hover:bg-[#221c15] border border-[#3a2e1e] rounded text-xs text-[#9d8f7b] font-serif flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Nombres</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleFinalSubmit}
              className="px-6 py-2.5 bg-[#382613] hover:bg-[#4d341a] border-2 border-[#d4af37] rounded text-xs text-[#f4eedb] font-serif font-bold uppercase tracking-wider flex items-center gap-2 transition-all shadow-lg hover:shadow-[#d4af37]/20 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#d4af37]" />
                  <span>Fundando Reino en Servidor...</span>
                </>
              ) : (
                <>
                  <span>🏰 FUNDAR MI REINO</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
