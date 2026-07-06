import { defineConfig } from 'vite';
import { baseViteConfig } from '../../configs/vite.base.ts';

// Dedicated dev/build port for marble_run (v1 used 5201/5211; 5210 is free in v2).
export default defineConfig(baseViteConfig({ server: { port: 5210 } }));
