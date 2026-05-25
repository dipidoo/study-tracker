export interface AppConfig {
  oauthClientId: string;
  scopes: string[];
  projectPrefix: string;
  proxyUrl?: string;
  contentSource: {
    owner: string;
    repo: string;
    branch: string;
    tracksPath: string;
  };
}

const LS_OVERRIDE_KEY = 'study-tracker:config';

let cached: AppConfig | undefined;

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const base = await fetch(`${import.meta.env.BASE_URL}config.json`).then((r) => r.json());
  const override = localStorage.getItem(LS_OVERRIDE_KEY);
  cached = override ? { ...base, ...JSON.parse(override) } : base;
  return cached!;
}

export function resolveConfig(config: AppConfig, viewerLogin: string): AppConfig {
  return {
    ...config,
    contentSource: {
      ...config.contentSource,
      owner: config.contentSource.owner || viewerLogin,
    },
  };
}

export function saveOverride(partial: Partial<AppConfig>): void {
  const existing = localStorage.getItem(LS_OVERRIDE_KEY);
  const merged = existing ? { ...JSON.parse(existing), ...partial } : partial;
  localStorage.setItem(LS_OVERRIDE_KEY, JSON.stringify(merged));
  cached = undefined;
}

export function clearOverride(): void {
  localStorage.removeItem(LS_OVERRIDE_KEY);
  cached = undefined;
}
