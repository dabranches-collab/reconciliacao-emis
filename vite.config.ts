import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const apiProxy={target:'https://reconciliacao-emis.dabranches.workers.dev',changeOrigin:true,secure:true};
export default defineConfig({ plugins: [react()], worker: { format: 'es' },server:{proxy:{'/api':apiProxy}},preview:{proxy:{'/api':apiProxy}} });
