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
  const defaultConvexUrl = 'https://fortunate-donkey-837.eu-west-1.convex.cloud';
  const convexUrl = fileUrl || env.VITE_CONVEX_URL || defaultConvexUrl;
  const defaultGoogleClientId = '198291664207-573hkldm168ltr0h5rscs0k8iooilqul.apps.googleusercontent.com';
  const googleClientId = env.VITE_GOOGLE_CLIENT_ID || defaultGoogleClientId;

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_CONVEX_URL': JSON.stringify(convexUrl),
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(googleClientId),
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
