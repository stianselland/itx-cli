import { Command } from "commander";
import { buildEntityGroup } from "./customer.js";

/**
 * Register `itx prospect ...` — mirrors `itx customer ...` but pre-filters
 * extension type to 9 (prospect). Implementation lives in customer.ts;
 * this file just forwards the role parameter so we keep one source of truth.
 */
export function registerProspectCommands(program: Command): void {
  buildEntityGroup(program, "prospect");
}
