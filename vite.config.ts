/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  worker: { format: "es" },
  test: { testTimeout: 120_000 },
});
