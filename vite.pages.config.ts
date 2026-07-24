import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "github-pages",
  base: "/fortune-market-backtest-1999/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "github-pages/index.html"),
        v2Magnitude: resolve(__dirname, "github-pages/v2-magnitude/index.html"),
        tenbaggerM0: resolve(__dirname, "github-pages/tenbagger-m0/index.html"),
        tenbaggerMainGod: resolve(__dirname, "github-pages/tenbagger-main-god/index.html"),
      },
    },
  },
});
