#!/usr/bin/env node

import { Command } from "commander";
import { registerConfigCommands } from "./commands/config.js";
import { registerTicketCommands } from "./commands/ticket.js";

const program = new Command();

program
  .name("itx")
  .description("CLI for the ITX Portal API")
  .version("0.1.0");

registerConfigCommands(program);
registerTicketCommands(program);

program.parse();
