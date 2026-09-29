import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["pg", "pg-native", "electron-store", "node-pty"],
    },
  },
});
