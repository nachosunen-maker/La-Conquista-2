import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { AuthProvider } from './auth';
import App from './App';
import './index.css';

function resolveConvexUrl(urlOrDeployment: string | undefined): string | null {
  if (!urlOrDeployment || typeof urlOrDeployment !== 'string') return null;
  const trimmed = urlOrDeployment.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      return null;
    }
  }
  // If the value is a Convex deployment key/name (e.g. dev:festive-dodo-429|... or dev:festive-dodo-429)
  const match = trimmed.match(/^(?:dev|prod):([a-z0-9-]+)/);
  if (match) {
    return `https://${match[1]}.convex.cloud`;
  }
  return null;
}

const DEFAULT_CONVEX_URL = 'https://festive-dodo-429.eu-west-1.convex.cloud';
const rawConvexUrl = import.meta.env.VITE_CONVEX_URL || DEFAULT_CONVEX_URL;
const convexUrl = resolveConvexUrl(rawConvexUrl) || DEFAULT_CONVEX_URL;
const rootElement = document.getElementById('root')!;

if (!convexUrl) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-neutral-900 border border-red-500/40 rounded-xl p-6 shadow-2xl text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-red-400 mb-2">Error de Configuración Convex</h1>
          <p className="text-sm text-neutral-300 mb-4 leading-relaxed">
            La variable de entorno <code className="bg-neutral-800 text-red-300 px-1.5 py-0.5 rounded text-xs font-mono">VITE_CONVEX_URL</code> debe ser una URL absoluta válida (por ejemplo: <code className="bg-neutral-800 text-neutral-200 px-1 py-0.5 rounded text-xs font-mono">https://festive-dodo-429.eu-west-1.convex.cloud/</code>).
          </p>
          <p className="text-xs text-neutral-400">
            Comprueba el valor en tu archivo <code className="font-mono text-neutral-300">.env.local</code>.
          </p>
        </div>
      </div>
    </React.StrictMode>
  );
} else {
  const convex = new ConvexReactClient(convexUrl);
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <AuthProvider convex={convex}>
          <App />
        </AuthProvider>
      </ConvexProvider>
    </React.StrictMode>
  );
}
