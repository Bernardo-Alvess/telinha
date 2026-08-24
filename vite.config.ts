/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function assertProductionApiUrl() {
  if (process.env.VITE_ALLOW_LOCAL_API === "1") {
    return;
  }
  const api = process.env.VITE_API_URL ?? "";
  if (!api || /localhost|127\.0\.0\.1/i.test(api)) {
    throw new Error(
      "Defina VITE_API_URL com a URL pública do servidor para o build de produção, ou VITE_ALLOW_LOCAL_API=1.",
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === "build" && mode === "production") {
    assertProductionApiUrl();
  }

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**", "**/server/**"],
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
