import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  getConfig,
  setConfig,
  clearConfig,
  isConfigured,
  getConfigPath,
} from "../lib/config.js";
import { ItxClient } from "../lib/client.js";
import { printError, printSuccess, printInfo, printJson } from "../lib/output.js";

const DEFAULT_SSO_ENDPOINT = "https://app.itxuc.com";

/** Parse an ITX API key string like `?tokenv2=...&rcntrl=...&ccntrl=...` */
export function parseApiKey(input: string): { tokenv2: string; rcntrl: string; ccntrl: string } | null {
  const trimmed = input.trim();
  // Accept with or without leading ?
  const qs = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
  const params = new URLSearchParams(qs);
  const tokenv2 = params.get("tokenv2");
  if (!tokenv2) return null;
  return {
    tokenv2,
    rcntrl: params.get("rcntrl") ?? "",
    ccntrl: params.get("ccntrl") ?? "",
  };
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || "";
}

export function registerConfigCommands(program: Command): void {
  // Top-level interactive login command
  program
    .command("login")
    .description("Log in with your ITX API key")
    .action(async () => {
      const apiKeyInput = await prompt("Paste API key (?tokenv2=...&rcntrl=...&ccntrl=...)");
      const parsed = parseApiKey(apiKeyInput);
      if (!parsed) {
        printError("Invalid API key. Expected format: ?tokenv2=...&rcntrl=...&ccntrl=...");
        process.exit(1);
      }

      setConfig({
        ssoEndpoint: DEFAULT_SSO_ENDPOINT,
        tokenv2: parsed.tokenv2,
        rcntrl: parsed.rcntrl,
        ccntrl: parsed.ccntrl,
      });
      printSuccess("Logged in.");
    });

  // Top-level logout command (replaces config clear)
  program
    .command("logout")
    .description("Log out and clear stored credentials")
    .action(() => {
      clearConfig();
      printSuccess("Logged out.");
    });

  // Top-level status command (replaces config test)
  program
    .command("status")
    .description("Show login status and test API connectivity")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json: boolean }) => {
      if (!isConfigured()) {
        printError('Not configured. Run "itx login" first.');
        process.exit(1);
      }

      const c = getConfig();
      const aliases = c.aliases ? Object.keys(c.aliases) : [];

      try {
        const client = new ItxClient();
        const endpoint = await client.resolveEndpoint();
        const user = await client.getActiveUser() as Record<string, unknown>;

        if (opts.json) {
          printJson({ user, endpoint, ssoEndpoint: c.ssoEndpoint, configPath: getConfigPath(), aliases: c.aliases });
          return;
        }

        const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "(unknown)";
        const email = (user.email as string) || "";
        const userId = user.userId ?? "";

        printSuccess("Connected");
        console.log();
        console.log(`  User:      ${name}${email ? ` <${email}>` : ""}`);
        console.log(`  User ID:   ${userId}`);
        console.log(`  Endpoint:  ${endpoint}`);
        console.log(`  SSO:       ${c.ssoEndpoint}`);
        console.log(`  Aliases:   ${aliases.length > 0 ? aliases.join(", ") : "(none)"}`);
        console.log(`  Config:    ${getConfigPath()}`);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  const config = program.command("config").description("View raw CLI configuration");

  config
    .command("show")
    .description("Show stored configuration values")
    .option("--reveal", "Show full token values")
    .action((opts: { reveal: boolean }) => {
      const c = getConfig();
      const mask = (val: string) =>
        opts.reveal || !val
          ? val || "(not set)"
          : val.slice(0, 8) + "..." + val.slice(-4);

      console.log(`SSO Endpoint:    ${c.ssoEndpoint || "(not set)"}`);
      console.log(`Active Endpoint: ${c.activeEndpoint || "(not resolved)"}`);
      console.log(`tokenv2:         ${mask(c.tokenv2)}`);
      console.log(`rcntrl:          ${mask(c.rcntrl)}`);
      console.log(`ccntrl:          ${mask(c.ccntrl)}`);
      console.log(`\nConfig file: ${getConfigPath()}`);
    });
}
