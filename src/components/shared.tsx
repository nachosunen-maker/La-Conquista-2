import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

/* ==========================================================================
   UTILIDADES COMPARTIDAS POR LOS PANELES (Aldea, Ejército, Universidad,
   Parlamento y Mapa). Sin lógica de reglas: todo número viene del backend.
   ========================================================================== */

export const RESOURCE_LABELS: Record<string, string> = {
  gold: 'Oro',
  wood: 'Madera',
  stone: 'Piedra',
  iron: 'Hierro',
  food: 'Alimentos',
};

export const RESOURCE_ORDER = ['gold', 'wood', 'stone', 'iron', 'food'] as const;

export const UNIT_LABELS: Record<string, string> = {
  infanteria: 'Infantería',
  arqueria: 'Arquería',
  caballeria: 'Caballería',
  asedio: 'Asedio',
};

export const JOB_LABELS: Record<string, string> = {
  agriculture: 'Agricultura',
  wood: 'Madera',
  stone: 'Piedra',
  iron: 'Hierro',
  gold: 'Oro',
};

export function formatSecondsDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const remainingMins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${remainingMins}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function formatCosts(costs: Record<string, number> | null | undefined): string {
  if (!costs) return 'sin coste registrado';
  const parts = RESOURCE_ORDER
    .filter((resource) => typeof costs[resource] === 'number' && costs[resource] > 0)
    .map((resource) => `${costs[resource].toLocaleString('es-ES')} ${RESOURCE_LABELS[resource].toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'gratuito';
}

export function formatRequirements(
  requirements: Record<string, number> | null | undefined,
  labels: Record<string, string> = {}
): string {
  if (!requirements) return 'pendientes';
  const entries = Object.entries(requirements);
  if (entries.length === 0) return 'ninguno';
  return entries.map(([type, level]) => `${labels[type] ?? type} nivel ${level}`).join(', ');
}

export function formatDateTime(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'sin fecha';
  return new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Reloj de visualización anclado al tiempo del servidor: el cliente solo
 * interpola los segundos transcurridos desde la última respuesta de Convex.
 */
export function useServerClock(serverTimeMs: number | undefined): number {
  const anchorRef = useRef<{ server: number; client: number } | null>(null);
  const [tick, setTick] = useState<number>(() => Date.now());

  useEffect(() => {
    if (typeof serverTimeMs === 'number') {
      anchorRef.current = { server: serverTimeMs, client: Date.now() };
    }
  }, [serverTimeMs]);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!anchorRef.current) return serverTimeMs ?? tick;
  return anchorRef.current.server + (tick - anchorRef.current.client);
}

/** Barra de progreso para colas (construcción, entrenamiento, investigación). */
export function ProgressRow(props: {
  title: string;
  subtitle?: string;
  startedAt: number | null | undefined;
  durationMs: number | null | undefined;
  serverTimeMs: number;
  onCancel?: () => void;
  cancelLabel?: string;
  cancelling?: boolean;
}) {
  const { title, subtitle, startedAt, durationMs, serverTimeMs, onCancel, cancelLabel, cancelling } = props;
  const hasTiming = typeof startedAt === 'number' && typeof durationMs === 'number' && durationMs > 0;
  const progress = hasTiming ? Math.max(0, Math.min(100, ((serverTimeMs - startedAt) / durationMs) * 100)) : null;
  const remaining = hasTiming ? Math.max(0, (startedAt + durationMs - serverTimeMs) / 1000) : null;
  return (
    <div className="bg-[#18140f] p-3 rounded-lg border border-[#2c2419] space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-[#f0e8d4]">{title}</span>
        <span className="font-mono text-[#d4af37]">{progress === null ? 'sin progreso' : `${Math.floor(progress)} %`}</span>
      </div>
      {subtitle && <p className="text-[11px] text-[#8e816d]">{subtitle}</p>}
      <p className="text-[11px] text-[#8e816d]">
        {remaining === null
          ? 'Tiempo restante no disponible.'
          : remaining <= 0
            ? 'Finalizado; el servidor lo aplicará en la próxima liquidación.'
            : `Tiempo restante: ${formatSecondsDuration(remaining)}`}
      </p>
      {progress !== null && (
        <div className="h-1.5 bg-[#0d0b09] rounded overflow-hidden">
          <div className="h-full bg-amber-600" style={{ width: `${progress}%` }} />
        </div>
      )}
      {onCancel && progress !== null && progress < 100 && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="rounded border border-rose-900/70 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
        >
          {cancelling ? 'Cancelando…' : cancelLabel ?? 'Cancelar (reembolso 50 %)'}
        </button>
      )}
    </div>
  );
}

export function PanelSection(props: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-[#14110d] border border-[#2b2419] rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#241e15] pb-3">
        <div className="flex items-center gap-2">
          {props.icon}
          <h2 className="text-sm font-serif font-bold uppercase tracking-wider text-[#e6ded0]">{props.title}</h2>
        </div>
        {props.aside && <div className="text-[11px] text-[#8e816d]">{props.aside}</div>}
      </div>
      {props.children}
    </section>
  );
}

export function normalizeErrorMessage(err: any): string {
  if (!err) return "No se han podido guardar los cambios. Inténtalo de nuevo.";
  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = err.message || err.data?.message || err.error?.message || err.error || "";
    if (!message) {
      try {
        message = JSON.stringify(err);
      } catch {
        message = String(err);
      }
    }
  }

  console.error('[La Conquista - Error Técnico]:', message);

  const lower = message.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("could not find public function")) {
    return "No ha sido posible conectar con el servidor del reino. Inténtalo de nuevo.";
  }
  if (lower.includes("server error") || lower.includes("convexerror")) {
    return "Este servicio del reino no está disponible en este momento.";
  }

  // If there's already a clean user-facing message, keep it
  let clean = message
    .replace(/^\[CONVEX[^\]]*\]\s*/gi, "")
    .replace(/^\[Request ID:[^\]]*\]\s*/gi, "")
    .replace(/^Server Error\s*/gi, "")
    .replace(/^Uncaught Error:\s*/gi, "")
    .replace(/\s*at\s+(?:handler|async|Object|\w+).*$/i, "")
    .replace(/\s*Called by client$/i, "")
    .trim();

  if (/Could not find public function|Failed to fetch|AssertionError/i.test(clean)) {
    return "No se han podido guardar los cambios. Inténtalo de nuevo.";
  }

  return clean || "No se han podido guardar los cambios. Inténtalo de nuevo.";
}

export function isInsufficientError(msg: string): boolean {
  if (!msg || typeof msg !== "string") return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes("recursos insuficientes") ||
    lower.includes("insuficientes") ||
    lower.includes("insuficiente") ||
    lower.includes("falta de recursos") ||
    lower.includes("saldo insuficiente") ||
    (lower.includes("recursos") && (lower.includes("requiere") || lower.includes("necesita") || lower.includes("necesarios")))
  );
}

export function isMarketFullError(msg: string): boolean {
  return typeof msg === "string" && msg.includes('NO HAY SITIO EN EL MERCADO');
}

export function getNormalizedResourceMessage(isConstruction: boolean): string {
  return isConstruction 
    ? 'No dispones de los recursos necesarios para realizar esta construcción.' 
    : 'No dispones de los recursos necesarios para realizar esta acción.';
}

export function StatusMessages(props: { error: string | null; message: string | null; isConstruction?: boolean }) {
  if (!props.error && !props.message) return null;
  const isInsufficient = props.error ? isInsufficientError(props.error) : false;
  const isMarketFull = props.error ? isMarketFullError(props.error) : false;
  
  return (
    <div className="space-y-1">
      {props.error && (
        isInsufficient ? (
          <div className="bg-rose-950/50 border border-rose-900 rounded-lg p-2.5 text-xs text-rose-300 space-y-0.5 shadow-md">
            <p className="font-bold uppercase tracking-wide">NO HAY RECURSOS SUFICIENTES</p>
            <p>{getNormalizedResourceMessage(!!props.isConstruction)}</p>
          </div>
        ) : isMarketFull ? (
          <div className="bg-rose-950/50 border border-rose-900 rounded-lg p-2.5 text-xs text-rose-300 space-y-0.5 shadow-md">
            <p className="font-bold uppercase tracking-wide">NO HAY SITIO EN EL MERCADO</p>
            <p>No tienes espacio suficiente en el almacén para recibir esta recompensa. Libera espacio e inténtalo de nuevo.</p>
          </div>
        ) : (
          <p role="alert" className="text-xs text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {props.error}
          </p>
        )
      )}
      {props.message && (
        <p role="status" className="text-xs text-emerald-400 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> {props.message}
        </p>
      )}
    </div>
  );
}

// ... (keep the rest of the file)


export const primaryButton =
  'rounded border border-[#6e5520] px-2.5 py-1 text-[11px] text-[#d4af37] hover:bg-[#2b2113] disabled:opacity-50 transition-colors';
export const dangerButton =
  'rounded border border-rose-900/70 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40 disabled:opacity-50 transition-colors';
export const inputClass =
  'rounded border border-[#3b3121] bg-[#100e0b] px-2 py-1 font-mono text-[#e6ded0] text-xs disabled:opacity-50';
export const selectClass =
  'rounded border border-[#3b3121] bg-[#100e0b] px-2 py-1 text-[#e6ded0] text-xs disabled:opacity-50';
export const cardClass = 'bg-[#18140f] p-3 rounded-lg border border-[#2c2419]';
export const readOnlyNote = 'Consulta de solo lectura: el Reino de Iberia no admite acciones.';

/** Ejecuta una mutación mostrando estado de carga, error y mensaje. */
export function useActionState(isConstruction: boolean = false) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<string | { success: boolean, error?: string } | void>) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      
      if (typeof result === 'string') {
        setMessage(result);
      } else if (result && typeof result === 'object') {
        // Soporte para el contrato { success: boolean, error?: string }
        if ('success' in result) {
          if (result.success === false) {
            const rawMsg = result.error || "Ha ocurrido un error inesperado.";
            const finalMsg = isInsufficientError(rawMsg) 
              ? getNormalizedResourceMessage(isConstruction) 
              : rawMsg;
            setError(finalMsg);
          } else if (typeof result === 'object' && result !== null) {
            // Si es éxito pero no devolvió string, al menos no es error
          }
        }
      }
    } catch (err) {
      const rawMsg = normalizeErrorMessage(err);
      const finalMsg = isInsufficientError(rawMsg) 
        ? getNormalizedResourceMessage(isConstruction) 
        : rawMsg;
      setError(finalMsg);
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, message, run, setError, setMessage };
}
