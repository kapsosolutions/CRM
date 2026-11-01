import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import crmDarkTheme from './build/crmDarkTheme';
import crmViewportUnits from './build/crmViewportUnits';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Env files sit next to this config ('.' = the frontend folder).
  const env = loadEnv(mode, '.', '');
  // Where the API runs. The dev server forwards to it, so the site, its API,
  // the live socket and Meta's webhooks all share ONE origin — which is what
  // lets the whole thing be opened over a single HTTPS tunnel (Meta's
  // WhatsApp signup popup refuses to run on an http:// page).
  const backend = env.BACKEND_URL || 'http://localhost:5055';
  return {
    plugins: [react()],
    // CRM stylesheets: viewport units that survive the 90% view (theme/scale.css),
    // and dark copies of the colour rules (switched on by <html data-theme="dark">).
    css: { postcss: { plugins: [crmViewportUnits(), crmDarkTheme()] } },
    build: {
      rollupOptions: {
        output: {
          // React rarely changes: its own file stays cached across deploys.
          manualChunks(id) {
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      open: true,
      // Vite only answers hosts it knows; allow the HTTPS tunnel's domain.
      // Newer free ngrok accounts get a fixed *.ngrok-free.dev domain.
      allowedHosts: ['localhost', '127.0.0.1', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', ...(env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : [])],
      proxy: {
        '/api': { target: backend, xfwd: true },
        '/socket.io': { target: backend, ws: true, xfwd: true },
      },
    },
  };
});
