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

export function registerConfigCommands(program: Command): void {
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
        printError('Not configured. Run "itx config set" first.');
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
}
