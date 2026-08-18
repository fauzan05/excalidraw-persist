import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const COSL_FRAME_ANCESTORS =
  "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000";

/** Persist API serves REST `/api` and collab WebSocket `/collab`. Embed talks to Vite :4002. */
const PERSIST_API_ORIGIN = 'http://127.0.0.1:4001';
const persistApiProxy = {
  '/api': {
    target: PERSIST_API_ORIGIN,
    changeOrigin: true,
  },
  '/collab': {
    target: PERSIST_API_ORIGIN,
    changeOrigin: true,
    ws: true,
    timeout: 3_600_000,
    proxyTimeout: 3_600_000,
  },
};

/** Vite SPA fallback only runs when Accept includes text/html. Playwright API GET would 404 /embed. */
function spaHtmlAcceptPlugin(): Plugin {
  return {
    name: 'cosl-spa-html-accept',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const pathOnly = (req.url || '').split('?')[0] || '';
        if (pathOnly === '/' || pathOnly.startsWith('/embed/')) {
          const accept = String(req.headers.accept || '');
          if (!accept.includes('text/html')) {
            req.headers.accept = accept ? `${accept},text/html` : 'text/html';
          }
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), spaHtmlAcceptPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4002,
    headers: {
      'Content-Security-Policy': COSL_FRAME_ANCESTORS,
    },
    proxy: persistApiProxy,
  },
  preview: {
    headers: {
      'Content-Security-Policy': COSL_FRAME_ANCESTORS,
    },
    proxy: persistApiProxy,
  },
});
