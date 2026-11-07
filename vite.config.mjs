import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", chunkSizeWarningLimit: 2000 },
  server: { port: 52901, strictPort: true },
  test: {
    include: ["tests/**/*.test.{js,jsx}", "src/**/*.test.{js,jsx}"],
    environment: "node",
  },
});
