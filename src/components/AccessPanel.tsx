import React, { useState } from 'react';
import { useAction, useQuery, useQuery_experimental } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { useAuthActions } from '@convex-dev/auth/react';
import { AlertTriangle, Check, Copy, Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { ACCOUNT } from '../../convex/balanceConfig';
import { ACCOUNT_MESSAGES } from '../../convex/accountRules';

/* ==========================================================================
   PANEL DE ACCESO (sección 5 de CLAUDE.md): crear cuenta · iniciar sesión ·
   invitado · recuperar contraseña, todo en la misma pantalla de inicio.
   Nombre de gobernante + contraseña, sin correo ni Google [DECISIÓN 21-10-2026].
   ========================================================================== */

const isRulerNameAvailableQuery = makeFunctionReference<'query'>('account:isRulerNameAvailable');
const resetPasswordAction = makeFunctionReference<'action'>('account:resetPasswordWithRecoveryCode');

type Mode = 'crear' | 'entrar' | 'recuperar';

/** Convierte los errores del servidor en mensajes genéricos en español (no revelan qué campo falla). */
export function describeAuthError(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data;
  const message = error instanceof Error ? error.message : String(error);
  if (/already exists/i.test(message)) return ACCOUNT_MESSAGES.NAME_TAKEN;
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(message)) return ACCOUNT_MESSAGES.INVALID_CREDENTIALS;
  if (/TooManyFailedAttempts/i.test(message)) return 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.';
  const convexData = /ConvexError: (.+?)(?: at |$)/.exec(message);
  if (convexData) return convexData[1].trim();
  return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

const panelInput =
  'w-full rounded-md border border-[#4a3b22] bg-[#100e0b] px-3 py-2.5 text-sm text-[#f1e9d6] placeholder:text-[#6e6352] focus:outline-none focus:border-[#d4af37] disabled:opacity-50';
const goldButton =
  'w-full py-3 rounded-md bg-gradient-to-b from-[#e2c25c] to-[#b8902a] text-[#1a1407] font-serif font-bold text-sm uppercase tracking-wider shadow-md hover:from-[#ecd070] hover:to-[#c69b31] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer flex items-center justify-center gap-2';
const linkButton = 'text-[#d4af37] hover:text-[#f0d47a] underline underline-offset-2 cursor-pointer';

function PasswordField(props: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; disabled?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        disabled={props.disabled}
        className={`${panelInput} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8e816d] hover:text-[#d4af37] cursor-pointer"
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

/** Tarjeta que muestra el código de recuperación una sola vez (también la usa App al crear la cuenta). */
export function RecoveryCodeCard(props: { code: string; title: string; intro: string; onContinue: () => void; continueLabel: string }) {
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
      <div className="p-4 bg-[#0f0d0a] border-2 border-[#d4af37]/60 rounded-lg text-center">
        <div className="font-mono text-lg sm:text-xl tracking-[0.2em] text-[#f7e7b2] select-all break-all">{props.code}</div>
        <button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-1.5 text-xs text-[#d4af37] hover:text-[#f0d47a] cursor-pointer">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar código'}
        </button>
      </div>
      <div className="p-3 bg-rose-950/30 border border-rose-700/40 rounded-md text-[11px] text-rose-200 leading-relaxed flex gap-2">
        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
        <span>
          <strong>Guárdalo ahora</strong> (apúntalo o haz una captura). No se volverá a mostrar y sin él no podrás recuperar la cuenta si olvidas la contraseña: no hay correo de recuperación.
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs text-[#e6ded0] cursor-pointer">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="accent-[#d4af37]" />
        He guardado mi código de recuperación en un lugar seguro.
      </label>
      <button type="button" disabled={!saved} onClick={props.onContinue} className={goldButton}>
        {props.continueLabel}
      </button>
    </div>
  );
}

function StepsRow(props: { active: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Tu identidad de gobernante' },
    { n: 2, label: 'Elige tu civilización', hint: 'cada civilización tiene sus propias ventajas y desafíos' },
    { n: 3, label: 'Bautiza tu reino y tu capital' },
  ] as const;
  return (
    <ol className="grid grid-cols-3 gap-2 text-[10px] sm:text-[11px]">
      {steps.map((step) => {
        const active = step.n === props.active;
        return (
          <li key={step.n} className={`flex flex-col items-center text-center gap-1 ${active ? 'text-[#f4eedb]' : 'text-[#6e6352]'}`} title={'hint' in step ? step.hint : undefined}>
            <span className={`w-6 h-6 rounded-full border flex items-center justify-center font-serif font-bold ${active ? 'border-[#d4af37] bg-[#2a1f11] text-[#d4af37]' : 'border-[#3b3121]'}`}>{step.n}</span>
            <span className="leading-tight">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function GuestWarning(props: { onContinue: () => void; onCreateAccount: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="max-w-md w-full bg-[#14120e] border-2 border-[#d4af37]/60 rounded-xl p-6 space-y-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <h3 className="text-base font-serif font-bold text-[#f4eedb]">Entrar como invitado</h3>
        </div>
        <p className="text-xs text-[#c5b7a0] leading-relaxed">
          Como invitado puedes ver cómo es una civilización y el juego, pero <strong className="text-amber-300">no se guardará tu progreso</strong>. Si cierras o recargas, lo perderás. Crea una cuenta para conservarlo.
        </p>
        <p className="text-[11px] text-[#8e816d]">
          Verás el reino de demostración Iberia en solo lectura: sin fundar reino, sin aparecer en el mapa ni desafiar a nadie.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={props.onContinue} className="flex-1 py-2.5 rounded-md border border-[#d4af37]/50 text-[#d4af37] text-xs font-serif font-semibold hover:bg-[#2a1f11] cursor-pointer">
            Continuar como invitado
          </button>
          <button type="button" onClick={props.onCreateAccount} className={`flex-1 ${goldButton} py-2.5`}>
            Crear cuenta
          </button>
        </div>
        <button type="button" onClick={props.onClose} className="w-full text-[11px] text-[#8e816d] hover:text-[#c5b7a0] cursor-pointer">
          Volver
        </button>
      </div>
    </div>
  );
}

export function AccessPanel(props: { onGuest: () => void; initialMode?: Mode }) {
  const { signIn } = useAuthActions();
  const resetPassword = useAction(resetPasswordAction);

  const [mode, setMode] = useState<Mode>(props.initialMode ?? 'crear');
  const [rulerName, setRulerName] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuestWarning, setShowGuestWarning] = useState(false);
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
        if (availability && !availability.available) throw new ConvexError(availability.error ?? ACCOUNT_MESSAGES.NAME_TAKEN);
        await signIn('password', { username: trimmedName, password, flow: 'signUp' });
        // Tras crear la cuenta, App muestra el código de recuperación una sola vez y después el asistente (paso 2).
      } else if (mode === 'entrar') {
        await signIn('password', { username: trimmedName, password, flow: 'signIn' });
      } else {
        const result = (await resetPassword({ rulerName: trimmedName, recoveryCode, newPassword })) as { recoveryCode: string };
        setIssuedCode(result.recoveryCode);
        setRecoveryCode('');
        setNewPassword('');
      }
    } catch (err) {
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

  return (
    <div className="bg-[#14120e] border-2 border-[#b8902a]/70 rounded-xl p-5 sm:p-6 shadow-2xl space-y-5 relative">
      {showGuestWarning && (
        <GuestWarning
          onContinue={() => {
            setShowGuestWarning(false);
            props.onGuest();
          }}
          onCreateAccount={() => {
            setShowGuestWarning(false);
            switchMode('crear');
          }}
          onClose={() => setShowGuestWarning(false)}
        />
      )}

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
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-serif font-bold text-[#f4eedb]">
              {mode === 'crear' ? 'Comienza tu reinado' : mode === 'entrar' ? 'Retoma tu reinado' : 'Recupera tu cuenta'}
            </h2>
            <p className="text-xs text-[#a09480]">
              {mode === 'crear'
                ? 'Crea tus credenciales para conservar tu progreso.'
                : mode === 'entrar'
                  ? 'Entra con tu nombre de gobernante desde cualquier dispositivo.'
                  : 'Escribe tu nombre de gobernante y el código de recuperación que guardaste al crear la cuenta.'}
            </p>
          </div>

          {mode === 'crear' && <StepsRow active={1} />}

          <div className="space-y-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-wider text-[#8e816d] font-semibold">Nombre de gobernante</span>
              <input
                type="text"
                value={rulerName}
                onChange={(e) => setRulerName(e.target.value)}
                placeholder="Ej. Alfonso de Castilla"
                autoComplete="username"
                maxLength={ACCOUNT.RULER_NAME_MAX_LENGTH}
                disabled={busy}
                className={panelInput}
              />
              {mode === 'crear' && availability && !availability.available && (
                <span className="block text-[11px] text-rose-400">{availability.error}</span>
              )}
              {mode === 'crear' && availability?.available && (
                <span className="block text-[11px] text-emerald-400">Nombre disponible.</span>
              )}
            </label>

            {mode !== 'recuperar' ? (
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-[#8e816d] font-semibold">Contraseña</span>
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  placeholder={`Mínimo ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`}
                  autoComplete={mode === 'crear' ? 'new-password' : 'current-password'}
                  disabled={busy}
                />
                {mode === 'crear' && passwordTooShort && (
                  <span className="block text-[11px] text-rose-400">La contraseña debe tener al menos {ACCOUNT.PASSWORD_MIN_LENGTH} caracteres.</span>
                )}
              </label>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-[#8e816d] font-semibold">Código de recuperación</span>
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    autoComplete="one-time-code"
                    disabled={busy}
                    className={`${panelInput} font-mono uppercase tracking-widest`}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-[#8e816d] font-semibold">Nueva contraseña</span>
                  <PasswordField value={newPassword} onChange={setNewPassword} placeholder={`Mínimo ${ACCOUNT.PASSWORD_MIN_LENGTH} caracteres`} autoComplete="new-password" disabled={busy} />
                </label>
              </>
            )}
          </div>

          {error && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-700/50 rounded-md text-[11px] text-rose-200 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={!canSubmit} className={goldButton}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'crear' ? 'Crear mi cuenta' : mode === 'entrar' ? 'Entrar' : 'Cambiar contraseña'}
          </button>
          {/* P70: qué hace · cuánto cuesta · cuánto tarda · resultado */}
          <p className="text-[10px] text-[#6e6352] text-center leading-relaxed">
            {mode === 'crear'
              ? 'Crea tu cuenta · gratis · inmediato · verás tu código de recuperación y pasarás a elegir civilización.'
              : mode === 'entrar'
                ? 'Abre tu sesión · gratis · inmediato · vuelves a tu reino o al asistente de fundación si aún no lo has fundado.'
                : 'Cambia la contraseña · gratis · inmediato · se cierran las demás sesiones y recibes un código nuevo.'}
          </p>

          <div className="text-xs text-[#a09480] text-center space-y-1.5">
            {mode === 'crear' && (
              <p>
                ¿Ya tienes una cuenta?{' '}
                <button type="button" onClick={() => switchMode('entrar')} className={linkButton}>
                  Iniciar sesión
                </button>
              </p>
            )}
            {mode === 'entrar' && (
              <>
                <p>
                  ¿Aún no tienes cuenta?{' '}
                  <button type="button" onClick={() => switchMode('crear')} className={linkButton}>
                    Crear cuenta
                  </button>
                </p>
                <p>
                  ¿Has olvidado la contraseña?{' '}
                  <button type="button" onClick={() => switchMode('recuperar')} className={linkButton}>
                    Usar código de recuperación
                  </button>
                </p>
              </>
            )}
            {mode === 'recuperar' && (
              <p>
                <button type="button" onClick={() => switchMode('entrar')} className={linkButton}>
                  Volver a iniciar sesión
                </button>
              </p>
            )}
          </div>

          <div className="border-t border-[#2d251a] pt-4 space-y-2">
            <button
              type="button"
              onClick={() => setShowGuestWarning(true)}
              className="w-full py-2.5 rounded-md border border-[#4a3b22] text-[#c5a059] text-xs font-serif font-semibold uppercase tracking-wider hover:bg-[#1e1710] cursor-pointer"
            >
              Entrar como invitado
            </button>
            <p className="text-[10px] text-[#6e6352] text-center">Invitado: el progreso podría perderse y no se garantiza su recuperación.</p>
          </div>
        </form>
      )}
    </div>
  );
}
