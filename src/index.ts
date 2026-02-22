#!/usr/bin/env node

import { createRequire } from "module";
import { Command } from "commander";
import { registerConfigCommands } from "./commands/config.js";
import { registerTicketCommands } from "./commands/ticket.js";
import { registerUserCommands } from "./commands/user.js";
import { registerAliasCommands } from "./commands/alias.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("itx")
  .description("CLI for the ITX Portal API")
  .version(version);

registerConfigCommands(program);
registerTicketCommands(program);
registerUserCommands(program);
registerAliasCommands(program);

program.parse();
