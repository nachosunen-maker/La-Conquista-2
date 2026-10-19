import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';

// Helper to parse .env.local if present
function getLocalEnvUrl(): string | undefined {
  if (fs.existsSync('.env.local')) {
    const content = fs.readFileSync('.env.local', 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*VITE_CONVEX_URL\s*=\s*(.+)$/);
      if (match) {
        return match[1].trim();
      }
    }
  }
  return undefined;
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileUrl = getLocalEnvUrl();
  const env = loadEnv(mode, process.cwd(), '');
  const defaultConvexUrl = 'https://festive-dodo-429.eu-west-1.convex.cloud';
  const convexUrl = fileUrl || env.VITE_CONVEX_URL || defaultConvexUrl;

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_CONVEX_URL': JSON.stringify(convexUrl),
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      watch: {
        usePolling: true,
        interval: 100,
      },
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    },
  };
});
