import React, { useState, useEffect, useRef } from 'react';
import { useConvex, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Activity, Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

const getViewerQuery = makeFunctionReference<"query">("kingdoms:getViewer");

export function ConvexDiagnosticsOverlay() {
  const convex = useConvex();
  const [wsConnected, setWsConnected] = useState<boolean>(() => {
    try {
      return Boolean(convex?.connectionState?.()?.isWebSocketConnected);
    } catch {
      return false;
    }
  });
  const [lastError, setLastError] = useState<string>("Sin error detallado disponible");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const startTimeRef = useRef<number>(Date.now());

  // Viewer query to test actual query response
  const viewerResult = useQuery(getViewerQuery);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    let unsubscribe: (() => void) | undefined;
    try {
      if (convex && typeof convex.subscribeToConnectionState === 'function') {
        unsubscribe = convex.subscribeToConnectionState((state: any) => {
          setWsConnected(Boolean(state.isWebSocketConnected));
          if (state.lastError) {
            setLastError(String(state.lastError));
          }
        });
      }
    } catch (err) {
      setLastError(String(err));
    }

    return () => {
      clearInterval(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [convex]);

  // URL del cliente
  const convexUrl = (convex as any)?.address ?? "URL no expuesta por cliente";

  let viewerStatus = "Pendiente (cargando)";
  if (viewerResult !== undefined) {
    viewerStatus = viewerResult === null ? "Null (sin sesión OIDC)" : "Respondido con éxito";
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-[#12100d] border-2 border-amber-500/80 rounded-xl p-4 shadow-2xl text-xs font-mono text-[#e8dfc8] space-y-2.5">
      <div className="flex items-center justify-between border-b border-amber-900/50 pb-2">
        <div className="flex items-center gap-2 text-amber-400 font-bold font-serif">
          <Activity className="w-4 h-4 animate-pulse" />
          <span>DIAGNÓSTICO CONVEX WEBSOCKET</span>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="p-1 bg-[#251e14] hover:bg-[#34281b] border border-amber-600/40 rounded text-amber-300"
          title="Recargar página"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between bg-[#19140f] p-2 rounded border border-[#2c2419]">
          <span className="text-[#8e816d]">Estado WebSocket:</span>
          {wsConnected ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5" /> CONECTADO
            </span>
          ) : (
            <span className="text-rose-400 font-semibold flex items-center gap-1">
              <WifiOff className="w-3.5 h-3.5" /> DESCONECTADO
            </span>
          )}
        </div>

        <div className="bg-[#19140f] p-2 rounded border border-[#2c2419] space-y-0.5">
          <span className="text-[#8e816d] block">URL de Convex:</span>
          <span className="text-amber-200 break-all select-all">{convexUrl}</span>
        </div>

        <div className="flex items-center justify-between bg-[#19140f] p-2 rounded border border-[#2c2419]">
          <span className="text-[#8e816d]">Tiempo transcurrido:</span>
          <span className="text-[#f4eedb]">{elapsedSeconds} s</span>
        </div>

        <div className="flex items-center justify-between bg-[#19140f] p-2 rounded border border-[#2c2419]">
          <span className="text-[#8e816d]">Último Error Real:</span>
          <span className="text-rose-400 truncate max-w-[180px]" title={lastError}>
            {lastError}
          </span>
        </div>

        <div className="flex items-center justify-between bg-[#19140f] p-2 rounded border border-[#2c2419]">
          <span className="text-[#8e816d]">Consulta (getViewer):</span>
          <span className={viewerResult !== undefined ? "text-emerald-400" : "text-amber-400"}>
            {viewerStatus}
          </span>
        </div>
      </div>

      <div className="text-[10px] text-[#786c5a] pt-1 border-t border-[#261f17]">
        ℹ Si el WebSocket permanece desconectado, comprueba las restricciones de red o firewall de AI Studio para dominios *.convex.cloud.
      </div>
    </div>
  );
}
