import { isConfigured } from "./config.js";
import { ItxClient } from "./client.js";
import {
  printError,
  printJsonError,
  exitWithError,
} from "./output.js";

/**
 * Returns an authenticated `ItxClient`, or exits with code 5 (AUTH).
 *
 * Single source of truth for the "are we logged in?" check used by every
 * command. When `opts.json` is true, the failure surfaces as the JSON error
 * envelope on stdout; otherwise it's a plain stderr message.
 */
export function requireAuth(opts: { json?: boolean } = {}): ItxClient {
  if (!isConfigured()) {
    if (opts.json) {
      printJsonError("AUTH", 'Not configured. Run "itx login" first.');
    } else {
      printError('Not configured. Run "itx login" first.');
    }
    exitWithError("AUTH");
  }
  return new ItxClient();
}
