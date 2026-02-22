import { Command } from "commander";
import { getAliases, setAlias, removeAlias } from "../lib/config.js";
import { printError, printSuccess, printInfo } from "../lib/output.js";

export function registerAliasCommands(program: Command): void {
  const alias = program
    .command("alias")
    .alias("a")
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
