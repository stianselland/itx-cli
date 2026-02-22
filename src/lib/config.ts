import Conf from "conf";

export interface ItxConfig {
  ssoEndpoint: string;
  tokenv2: string;
  rcntrl: string;
  ccntrl: string;
  activeEndpoint?: string;
  aliases: Record<string, string>;
}

const config = new Conf<ItxConfig>({
  projectName: "itx-cli",
  // When ITX_CONFIG_DIR is set (e.g. in tests), use an isolated directory
  // so tests never touch real user credentials.
  ...(process.env.ITX_CONFIG_DIR ? { cwd: process.env.ITX_CONFIG_DIR } : {}),
  schema: {
    ssoEndpoint: {
      type: "string",
      default: "",
    },
    tokenv2: {
      type: "string",
      default: "",
    },
    rcntrl: {
      type: "string",
      default: "",
    },
    ccntrl: {
      type: "string",
      default: "",
    },
    activeEndpoint: {
      type: "string",
      default: "",
    },
    aliases: {
      type: "object",
      default: {},
    },
  },
});

export function getConfig(): ItxConfig {
  return {
    ssoEndpoint: config.get("ssoEndpoint"),
    tokenv2: config.get("tokenv2"),
    rcntrl: config.get("rcntrl"),
    ccntrl: config.get("ccntrl"),
    activeEndpoint: config.get("activeEndpoint"),
    aliases: config.get("aliases"),
  };
}

export function setConfig(values: Partial<ItxConfig>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      config.set(key as keyof ItxConfig, value);
    }
  }
}

export function clearConfig(): void {
  config.clear();
}

export function isConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.ssoEndpoint && c.tokenv2);
}

export function getConfigPath(): string {
  return config.path;
}

export function getAliases(): Record<string, string> {
  return config.get("aliases");
}

export function setAlias(name: string, value: string): void {
  const aliases = config.get("aliases");
  aliases[name] = value;
  config.set("aliases", aliases);
}

export function removeAlias(name: string): boolean {
  const aliases = config.get("aliases");
  if (!(name in aliases)) return false;
  delete aliases[name];
  config.set("aliases", aliases);
  return true;
}

export function resolveAlias(nameOrValue: string): string {
  const aliases = config.get("aliases");
  return aliases[nameOrValue] ?? nameOrValue;
}
