import React, { useState, useEffect } from 'react';
import { useAction, useQuery_experimental } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { useAuthActions } from '@convex-dev/auth/react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  User,
  Lock,
  ChevronRight,
  Info
} from 'lucide-react';
import { ACCOUNT } from '../../convex/balanceConfig';
import { ACCOUNT_MESSAGES } from '../../convex/accountRules';

/* ==========================================================================
   PANEL DE ACCESO OFICIAL (LA CONQUISTA)
   Reproducción exacta de la referencia aprobada:
   - Paso 1: Tu identidad de gobernante (Nombre, Contraseña, Crear mi cuenta,
     Iniciar sesión, Entrar como invitado).
   - Paso 2: Elige tu civilización.
   - Paso 3: Bautiza tu reino y tu capital.
   ========================================================================== */

const isRulerNameAvailableQuery = makeFunctionReference<'query'>('account:isRulerNameAvailable');
const resetPasswordAction = makeFunctionReference<'action'>('account:resetPasswordWithRecoveryCode');

type Mode = 'crear' | 'entrar' | 'recuperar';

/**
 * Convierte los errores del servidor y de la red en mensajes comprensibles para el usuario,
 * preservando la causa técnica sin ocultar excepciones críticas.
 */
export function describeAuthError(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data;
  const message = error instanceof Error ? error.message : String(error);

  // Funciones no desplegadas en el backend remoto de Convex
  if (/Could not find public function for 'auth:signIn'/i.test(message)) {
    return 'El servidor Convex remoto aún no tiene desplegado el módulo de autenticación (falta "auth:signIn"). Es necesario desplegar el backend Convex mediante "npx convex dev" o "npx convex deploy".';
  }
  if (/Could not find public function for '([^']+)'/i.test(message)) {
    const match = /Could not find public function for '([^']+)'/i.exec(message);
    return `Función "${match ? match[1] : 'requerida'}" no disponible en el servidor Convex remoto. Requiere desplegar el backend.`;
  }

  // Nombre de gobernante ya ocupado
  if (/already exists|already in use|nombre.+ocupado/i.test(message)) {
    return ACCOUNT_MESSAGES.NAME_TAKEN;
  }

  // Credenciales erróneas
  if (/InvalidSecret|InvalidAccountId|Invalid credentials|credenciales incorrectas/i.test(message)) {
    return ACCOUNT_MESSAGES.INVALID_CREDENTIALS;
  }

  // Límite de intentos
  if (/TooManyFailedAttempts/i.test(message)) {
    return 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.';
  }

  // Error de conexión o red con Convex
  if (/Failed to fetch|NetworkError|Network request failed|net::ERR_|Failed to load resource/i.test(message)) {
    return 'No se pudo conectar con el servidor Convex. Comprueba tu conexión a Internet o el estado del backend.';
  }

  // Datos encapsulados en ConvexError
  const convexData = /ConvexError:\s*([^\n\r]+)/.exec(message);
  if (convexData) return convexData[1].trim();

  // Si el servidor devolvió un Server Error específico de UDF
  if (/Server Error/i.test(message)) {
    const cleanMsg = message.replace(/\[Request ID:\s*[a-zA-Z0-9]+\]\s*/i, '').replace(/^Server Error\s*/i, '').trim();
    if (cleanMsg) return `Error del servidor: ${cleanMsg}`;
  }

  return 'No se pudo completar la operación. Comprueba los datos o el estado de la conexión.';
}

/** Decoración ornamental en las 4 esquinas del marco medieval */
function CornerAccent({ position }: { position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }) {
  const positionClass = {
    'top-left': 'top-1.5 left-1.5',
    'top-right': 'top-1.5 right-1.5 rotate-90',
    'bottom-left': 'bottom-1.5 left-1.5 -rotate-90',
    'bottom-right': 'bottom-1.5 right-1.5 rotate-180',
  }[position];

  return (
    <svg
      className={`absolute ${positionClass} w-3.5 h-3.5 text-[#c59b3c] pointer-events-none opacity-85 select-none`}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M1 15V4C1 2.34315 2.34315 1 4 1H15" stroke="currentColor" strokeWidth="1.2" />
      <polygon points="5,5 3,7 5,9 7,7" fill="currentColor" />
    </svg>
  );
}

/** Tarjeta que muestra el código de recuperación una sola vez */
export function RecoveryCodeCard(props: {
  code: string;
  title: string;
  intro: string;
  onContinue: () => void;
  continueLabel: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-[#d4af37]" />
        <h3 className="text-base font-serif font-bold text-[#f4eedb]">{props.title}</h3>
      </div>
      <p className="text-xs text-[#c5b7a0] leading-relaxed">{props.intro}</p>
      <div className="p-4 bg-[#080c14] border-2 border-[#d4af37]/60 rounded-lg text-center shadow-inner">
        <div className="font-mono text-lg sm:text-xl tracking-[0.2em] text-[#f7e7b2] select-all break-all">
          {props.code}
        </div>
        <button
          type="button"
          onClick={copy}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#d4af37] hover:text-[#f0d47a] cursor-pointer transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado al portapapeles' : 'Copiar código'}
        </button>
      </div>
      <div className="p-3 bg-rose-950/30 border border-rose-700/40 rounded-md text-[11px] text-rose-200 leading-relaxed flex gap-2">
        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
        <span>
          <strong>Guárdalo ahora</strong> (apúntalo o haz una captura). No se volverá a mostrar y sin él no podrás recuperar la cuenta si olvidas la contraseña: no hay correo de recuperación.
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs text-[#e6ded0] cursor-pointer">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="accent-[#d4af37] w-4 h-4 rounded cursor-pointer"
        />
        <span>He guardado mi código de recuperación en un lugar seguro.</span>
      </label>
      <button
        type="button"
        disabled={!saved}
        onClick={props.onContinue}
        className="w-full py-3 rounded-lg bg-gradient-to-r from-[#ba8332] via-[#cf993f] to-[#ba8332] text-[#140e04] font-serif font-bold text-sm tracking-wide shadow-md hover:from-[#c99138] hover:via-[#dea74b] hover:to-[#c99138] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center justify-center gap-2"
      >
        {props.continueLabel}
      </button>
    </div>
  );
}

export function AccessPanel(props: { initialMode?: Mode; isStageOverlay?: boolean }) {
  const { signIn } = useAuthActions();
  const resetPassword = useAction(resetPasswordAction);

  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'crear');
  const [rulerName, setRulerName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const trimmedName = rulerName.trim();
  const availabilityResult = useQuery_experimental({
    query: isRulerNameAvailableQuery,
    args: mode === 'crear' && trimmedName.length >= ACCOUNT.RULER_NAME_MIN_LENGTH ? { rulerName: trimmedName } : 'skip',
    throwOnError: false,
  });
  const availability = availabilityResult.status === 'success'
    ? (availabilityResult.data as { available: boolean; error: string | null })
    : undefined;

  // Registro de diagnóstico seguro si la consulta de disponibilidad falla
  useEffect(() => {
    if (availabilityResult.status === 'error') {
      console.warn('[La Conquista - Disponibilidad]', {
        rulerName: trimmedName,
        error: availabilityResult.error.message,
      });
    }
  }, [availabilityResult, trimmedName]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setIssuedCode(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'crear') {
        if (availability && !availability.available) {
          throw new ConvexError(availability.error ?? ACCOUNT_MESSAGES.NAME_TAKEN);
        }
        await signIn('password', { username: trimmedName, password, flow: 'signUp' });
      } else if (mode === 'entrar') {
        await signIn('password', { username: trimmedName, password, flow: 'signIn' });
      } else {
        const result = (await resetPassword({
          rulerName: trimmedName,
          recoveryCode,
          newPassword,
        })) as { recoveryCode: string };
        setIssuedCode(result.recoveryCode);
        setRecoveryCode('');
        setNewPassword('');
      }
    } catch (err) {
      // Registro de diagnóstico técnico seguro (sin contraseñas, tokens ni códigos)
      console.error('[La Conquista - Error Autenticación]', {
        modo: mode,
        nombreGobernante: trimmedName,
        error: err instanceof Error ? err.message : String(err),
      });
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const passwordTooShort = password.length > 0 && password.length < ACCOUNT.PASSWORD_MIN_LENGTH;
  const canSubmit =
    !busy &&
    trimmedName.length >= ACCOUNT.RULER_NAME_MIN_LENGTH &&
    (mode === 'recuperar'
      ? recoveryCode.trim().length > 0 && newPassword.length >= ACCOUNT.PASSWORD_MIN_LENGTH
      : password.length >= ACCOUNT.PASSWORD_MIN_LENGTH && (mode === 'entrar' || !availability || availability.available));

  const containerClasses = props.isStageOverlay
    ? 'relative w-full h-full flex flex-col justify-between'
    : 'relative w-full max-w-[480px]';

  return (
    <div className={containerClasses}>
      {/* Marco ornamental medieval exterior con doble filete dorado */}
      <div className={`relative ${props.isStageOverlay ? 'w-full h-full' : ''} rounded-2xl p-[2.5px] bg-gradient-to-b from-[#b8862d]/70 via-[#42341d]/40 to-[#b8862d]/70 shadow-[0_12px_45px_rgba(0,0,0,0.85)]`}>
        <div className={`relative ${props.isStageOverlay ? 'w-full h-full' : ''} rounded-[13px] bg-[#090e17] border border-[#c59b3c]/40 p-3.5 sm:p-5 lg:p-6 shadow-2xl flex flex-col justify-between overflow-y-auto`}>
          {/* Adornos en las 4 esquinas */}
          <CornerAccent position="top-left" />
          <CornerAccent position="top-right" />
          <CornerAccent position="bottom-left" />
          <CornerAccent position="bottom-right" />

          {mode === 'recuperar' && issuedCode ? (
            <RecoveryCodeCard
              code={issuedCode}
              title="Contraseña cambiada: tu nuevo código"
              intro="Tu contraseña se ha cambiado y todas las sesiones anteriores se han cerrado. El código que usaste ya no vale: este es el nuevo."
              continueLabel="Iniciar sesión con la nueva contraseña"
              onContinue={() => {
                setIssuedCode(null);
                switchMode('entrar');
              }}
            />
          ) : (
            <div className="space-y-5">
              {/* Encabezado del panel según la referencia */}
              <div className="space-y-1">
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#f5e6c4] tracking-wide">
                  {mode === 'crear' ? 'Comienza tu reinado' : mode === 'entrar' ? 'Retoma tu reinado' : 'Recupera tu cuenta'}
                </h2>
                <p className="text-xs text-[#a09a8a] leading-relaxed">
                  {mode === 'crear'
                    ? 'Crea tus credenciales para conservar tu progreso.'
                    : mode === 'entrar'
                      ? 'Entra con tu nombre de gobernante desde cualquier dispositivo.'
                      : 'Escribe tu nombre de gobernante y tu código de recuperación.'}
                </p>
              </div>

              {/* Estructura vertical de 3 pasos idéntica a la imagen oficial */}
              <div className="space-y-0">
                {/* ----------------------------------------------------
                    PASO 1: TU IDENTIDAD DE GOBERNANTE
                    ---------------------------------------------------- */}
                <div className="flex items-start gap-3.5 relative">
                  {/* Indicador numérico 1 y línea vertical conectora */}
                  <div className="flex flex-col items-center flex-shrink-0 self-stretch">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-[#d4af37] bg-gradient-to-b from-[#e8cb6b] to-[#b88c28] text-[#140e04] font-serif font-bold text-xs sm:text-sm flex items-center justify-center shadow-md">
                      1
                    </div>
                    {/* Línea vertical conectora hacia el paso 2 */}
                    <div className="w-[1.5px] bg-[#3a4454] flex-1 my-1.5" />
                  </div>

                  {/* Contenido del Paso 1 */}
                  <div className="flex-1 pb-4">
                    <h3 className="font-serif font-bold text-[#f2edd8] text-sm sm:text-base mb-3 pt-0.5">
                      {mode === 'crear'
                        ? 'Tu identidad de gobernante'
                        : mode === 'entrar'
                          ? 'Tus credenciales de gobernante'
                          : 'Identidad y recuperación'}
                    </h3>

                    <form onSubmit={submit} className="space-y-3.5">
                      {/* Campo: Nombre de gobernante */}
                      <div>
                        <label className="block text-xs font-semibold text-[#a8a192] mb-1.5">
                          Nombre de gobernante
                        </label>
                        <div className="relative">
                          <User className="w-4 h-4 text-[#6e7888] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={rulerName}
                            onChange={(e) => setRulerName(e.target.value)}
                            placeholder="Ej. Alfonso de Castilla"
                            autoComplete="username"
                            maxLength={ACCOUNT.RULER_NAME_MAX_LENGTH}
                            disabled={busy}
                            className="w-full bg-[#0c121d] border border-[#263143] focus:border-[#c59b3c] rounded-lg pl-9.5 pr-3 py-2 sm:py-2.5 text-xs sm:text-sm text-[#f0e8d6] placeholder:text-[#505a6b] focus:outline-none transition-colors disabled:opacity-50"
                          />
                        </div>
                        {mode === 'crear' && availability && !availability.available && (
                          <span className="block text-[11px] text-rose-400 mt-1">{availability.error}</span>
                        )}
                        {mode === 'crear' && availability?.available && (
                          <span className="block text-[11px] text-emerald-400 mt-1">Nombre disponible.</span>
                        )}
                      </div>

                      {/* Modo crear o entrar: Campo Contraseña */}
                      {mode !== 'recuperar' ? (
                        <div>
                          <label className="block text-xs font-semibold text-[#a8a192] mb-1.5">
                            Contraseña
                          </label>
                          <div className="relative">
                            <Lock className="w-4 h-4 text-[#6e7888] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder={`Mínimo ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`}
                              autoComplete={mode === 'crear' ? 'new-password' : 'current-password'}
                              disabled={busy}
                              className="w-full bg-[#0c121d] border border-[#263143] focus:border-[#c59b3c] rounded-lg pl-9.5 pr-10 py-2 sm:py-2.5 text-xs sm:text-sm text-[#f0e8d6] placeholder:text-[#505a6b] focus:outline-none transition-colors disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6e7888] hover:text-[#c59b3c] cursor-pointer transition-colors"
                              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          {mode === 'crear' && passwordTooShort && (
                            <span className="block text-[11px] text-rose-400 mt-1">
                              La contraseña debe tener al menos {ACCOUNT.PASSWORD_MIN_LENGTH} caracteres.
                            </span>
                          )}
                        </div>
                      ) : (
                        /* Modo recuperar: Código + Nueva contraseña */
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-semibold text-[#a8a192] mb-1.5">
                              Código de recuperación
                            </label>
                            <input
                              type="text"
                              value={recoveryCode}
                              onChange={(e) => setRecoveryCode(e.target.value)}
                              placeholder="XXXX-XXXX-XXXX-XXXX"
                              autoComplete="one-time-code"
                              disabled={busy}
                              className="w-full bg-[#0c121d] border border-[#263143] focus:border-[#c59b3c] rounded-lg px-3 py-2 sm:py-2.5 text-xs sm:text-sm text-[#f0e8d6] placeholder:text-[#505a6b] font-mono uppercase tracking-widest focus:outline-none transition-colors disabled:opacity-50"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-[#a8a192] mb-1.5">
                              Nueva contraseña
                            </label>
                            <div className="relative">
                              <Lock className="w-4 h-4 text-[#6e7888] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type={showNewPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={`Mínimo ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`}
                                autoComplete="new-password"
                                disabled={busy}
                                className="w-full bg-[#0c121d] border border-[#263143] focus:border-[#c59b3c] rounded-lg pl-9.5 pr-10 py-2 sm:py-2.5 text-xs sm:text-sm text-[#f0e8d6] placeholder:text-[#505a6b] focus:outline-none transition-colors disabled:opacity-50"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewPassword((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6e7888] hover:text-[#c59b3c] cursor-pointer transition-colors"
                                title={showNewPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                              >
                                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Notificación de error si surge */}
                      {error && (
                        <div className="p-2.5 bg-rose-950/40 border border-rose-700/50 rounded-lg text-[11px] text-rose-200 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                          <span>{error}</span>
                        </div>
                      )}

                      {/* Botón principal (exacto a la referencia visual) */}
                      <button
                        type="submit"
                        disabled={!canSubmit}
                        className="w-full py-2.5 sm:py-3 rounded-lg bg-gradient-to-r from-[#ba8332] via-[#cf993f] to-[#ba8332] hover:from-[#c99138] hover:via-[#dea74b] hover:to-[#c99138] text-[#140e04] font-serif font-bold text-xs sm:text-sm tracking-wide shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {mode === 'crear' ? 'Crear mi cuenta' : mode === 'entrar' ? 'Iniciar sesión' : 'Restablecer contraseña'}
                      </button>

                      {/* Enlace para alternar entre Crear e Iniciar sesión */}
                      <div className="text-center text-xs text-[#a09480] pt-1">
                        {mode === 'crear' ? (
                          <p>
                            ¿Ya tienes una cuenta?{' '}
                            <button
                              type="button"
                              onClick={() => switchMode('entrar')}
                              className="text-[#c59b3c] hover:text-[#edd59e] underline underline-offset-2 cursor-pointer transition-colors"
                            >
                              Iniciar sesión
                            </button>
                          </p>
                        ) : mode === 'entrar' ? (
                          <div className="space-y-1">
                            <p>
                              ¿Aún no tienes cuenta?{' '}
                              <button
                                type="button"
                                onClick={() => switchMode('crear')}
                                className="text-[#c59b3c] hover:text-[#edd59e] underline underline-offset-2 cursor-pointer transition-colors"
                              >
                                Crear mi cuenta
                              </button>
                            </p>
                            <p>
                              <button
                                type="button"
                                onClick={() => switchMode('recuperar')}
                                className="text-[11px] text-[#8e816d] hover:text-[#c59b3c] underline underline-offset-2 cursor-pointer transition-colors"
                              >
                                ¿Has olvidado tu contraseña?
                              </button>
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => switchMode('entrar')}
                            className="text-[#c59b3c] hover:text-[#edd59e] underline underline-offset-2 cursor-pointer transition-colors"
                          >
                            Volver a iniciar sesión
                          </button>
                        )}
                      </div>


                    </form>
                  </div>
                </div>

                {/* Separador entre pasos */}
                <div className="border-t border-[#1e2736] my-3 sm:my-4" />

                {/* ----------------------------------------------------
                    PASO 2: ELIGE TU CIVILIZACIÓN (SIGUIENTE PASO)
                    ---------------------------------------------------- */}
                <div className="flex items-start gap-3.5 relative">
                  <div className="flex flex-col items-center flex-shrink-0 self-stretch">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-[#2b3547] bg-[#0d131f] text-[#6b7688] font-serif font-bold text-xs sm:text-sm flex items-center justify-center">
                      2
                    </div>
                    <div className="w-[1.5px] bg-[#222b3b] flex-1 my-1.5" />
                  </div>

                  <div className="flex-1 pb-3">
                    <h3 className="font-serif font-bold text-[#a59e90] text-xs sm:text-sm pt-0.5">
                      Elige tu civilización
                    </h3>
                    <p className="text-[11px] sm:text-xs text-[#6e7787] mt-0.5 leading-snug">
                      Cada civilización tiene sus propias ventajas y desafíos.
                    </p>
                  </div>
                </div>

                {/* Separador entre pasos */}
                <div className="border-t border-[#1e2736] my-3 sm:my-4" />

                {/* ----------------------------------------------------
                    PASO 3: BAUTIZA TU REINO Y TU CAPITAL
                    ---------------------------------------------------- */}
                <div className="flex items-start gap-3.5 relative">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-[#2b3547] bg-[#0d131f] text-[#6b7688] font-serif font-bold text-xs sm:text-sm flex items-center justify-center">
                      3
                    </div>
                  </div>

                  <div className="flex-1">
                    <h3 className="font-serif font-bold text-[#a59e90] text-xs sm:text-sm pt-0.5">
                      Bautiza tu reino y tu capital
                    </h3>
                    <p className="text-[11px] sm:text-xs text-[#6e7787] mt-0.5 leading-snug">
                      Dale nombre a tu reino y a tu capital para comenzar la aventura.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
