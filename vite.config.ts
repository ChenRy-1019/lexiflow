import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5184 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/data/**"] },
  },
  build: {
    target: "es2021",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
