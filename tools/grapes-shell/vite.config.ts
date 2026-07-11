import { defineConfig } from "vite";
import { baseViteConfig } from "../../configs/vite.base.ts";

export default defineConfig(baseViteConfig({ server: { port: 5203 } }));
