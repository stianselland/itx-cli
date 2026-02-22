import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  getConfig,
  setConfig,
  clearConfig,
  isConfigured,
  getConfigPath,
  getAliases,
  setAlias,
  removeAlias,
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

  const config = program.command("config").description("Manage ITX CLI configuration");

  config
    .command("set")
    .description("Configure API credentials")
    .requiredOption("--sso-endpoint <url>", "SSO cluster endpoint (e.g. https://sso.itxuc.com)")
    .requiredOption("--tokenv2 <token>", "Authentication token (tokenv2)")
    .option("--rcntrl <token>", "rcntrl header value", "")
    .option("--ccntrl <token>", "ccntrl header value", "")
    .action((opts: { ssoEndpoint: string; tokenv2: string; rcntrl: string; ccntrl: string }) => {
      setConfig({
        ssoEndpoint: opts.ssoEndpoint,
        tokenv2: opts.tokenv2,
        rcntrl: opts.rcntrl,
        ccntrl: opts.ccntrl,
      });
      printSuccess("Configuration saved.");
      printInfo(`Config file: ${getConfigPath()}`);
    });

  config
    .command("show")
    .description("Show current configuration")
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

  config
    .command("clear")
    .description("Remove all stored configuration")
    .action(() => {
      clearConfig();
      printSuccess("Configuration cleared.");
    });

  config
    .command("test")
    .description("Test connectivity by resolving the active endpoint and fetching the active user")
    .action(async () => {
      if (!isConfigured()) {
        printError('Not configured. Run "itx login" first.');
        process.exit(1);
      }

      try {
        const client = new ItxClient();

        printInfo("Resolving active endpoint...");
        const endpoint = await client.resolveEndpoint();
        printSuccess(`Active endpoint: ${endpoint}`);

        printInfo("Fetching active user...");
        const user = await client.getActiveUser();
        printSuccess("Connection successful. Active user:");
        printJson(user);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  const alias = config
    .command("alias")
    .description("Manage user aliases (e.g. dave → dave@company.com)");

  alias
    .command("set <name> <value>")
    .description("Create or update an alias")
    .action((name: string, value: string) => {
      setAlias(name, value);
      printSuccess(`Alias set: ${name} → ${value}`);
    });

  alias
    .command("list")
    .alias("ls")
    .description("List all aliases")
    .action(() => {
      const aliases = getAliases();
      const entries = Object.entries(aliases);
      if (entries.length === 0) {
        printInfo("No aliases configured.");
        return;
      }
      for (const [name, value] of entries) {
        console.log(`  ${name} → ${value}`);
      }
    });

  alias
    .command("remove <name>")
    .alias("rm")
    .description("Remove an alias")
    .action((name: string) => {
      if (removeAlias(name)) {
        printSuccess(`Alias removed: ${name}`);
      } else {
        printError(`Alias not found: ${name}`);
      }
    });
}
