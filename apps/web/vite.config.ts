import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3010", changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    // The largest route-only dependency is Three.js (681 kB minified,
    // 172 kB gzip). It is lazy-loaded with the logistics 3D screen.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (
            moduleId.includes("/node_modules/react/") ||
            moduleId.includes("/node_modules/react-dom/")
          ) {
            return "vendor-react";
          }
          if (moduleId.includes("/node_modules/react-router/")) {
            return "vendor-router";
          }
          if (moduleId.includes("/node_modules/@tanstack/react-query/")) {
            return "vendor-query";
          }
          if (moduleId.includes("/node_modules/recharts/")) {
            return "vendor-charts";
          }
          if (moduleId.includes("/node_modules/@react-three/drei/")) {
            return "vendor-three-drei";
          }
          if (moduleId.includes("/node_modules/@react-three/fiber/")) {
            return "vendor-three-fiber";
          }
          if (moduleId.includes("/node_modules/three/examples/")) {
            return "vendor-three-extras";
          }
          if (moduleId.includes("/node_modules/three/")) {
            return "vendor-three";
          }
          return undefined;
        },
      },
    },
  },
});
