import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // Each test run gets an isolated config directory so tests never
      // touch real user credentials stored on disk.
      ITX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "itx-cli-test-")),
    },
    // Tests still share the same config file within a run, so keep serial.
    fileParallelism: false,
  },
});
