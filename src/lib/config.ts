import Conf from "conf";

export interface ItxConfig {
  ssoEndpoint: string;
  tokenv2: string;
  rcntrl: string;
  ccntrl: string;
  activeEndpoint?: string;
}

const config = new Conf<ItxConfig>({
  projectName: "itx-cli",
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
  },
});

export function getConfig(): ItxConfig {
  return {
    ssoEndpoint: config.get("ssoEndpoint"),
    tokenv2: config.get("tokenv2"),
    rcntrl: config.get("rcntrl"),
    ccntrl: config.get("ccntrl"),
    activeEndpoint: config.get("activeEndpoint"),
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
