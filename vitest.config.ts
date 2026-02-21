import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share a global conf config file on disk, so they cannot run in parallel
    fileParallelism: false,
  },
});
