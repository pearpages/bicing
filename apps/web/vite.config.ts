import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { serveData } from './serve-data';

// Cross-origin isolation unlocks performance.measureUserAgentSpecificMemory() for the benchmark
// overlay and SharedArrayBuffer for Phase 3. `credentialless` (not `require-corp`) still lets us
// fetch Parquet from a CORS-enabled external host. Must match nginx.conf.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [vue(), serveData(fileURLToPath(new URL('../..', import.meta.url)))],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: { format: 'es' },
});
