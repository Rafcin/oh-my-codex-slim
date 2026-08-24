import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const OMCS_LOCAL_MARKETPLACE_NAME = "omcs-local";
export const OMCS_PLUGIN_NAME = "oh-my-codex-slim";
export const OMCS_LOCAL_PLUGIN_CONFIG_KEY = `${OMCS_PLUGIN_NAME}@${OMCS_LOCAL_MARKETPLACE_NAME}`;

export interface PackagedOmcsMarketplace {
  marketplacePath: string;
  packageRoot: string;
  pluginRoot: string;
  pluginManifestPath: string;
}

interface MarketplaceManifest {
  name?: unknown;
  plugins?: Array<{
    name?: unknown;
    source?: { source?: unknown; path?: unknown };
  }>;
}

interface PluginManifest {
  name?: unknown;
  version?: unknown;
  skills?: unknown;
}

function pluginRootStaysInPackage(packageRoot: string, pluginRoot: string): boolean {
  const relativePluginRoot = relative(resolve(packageRoot), pluginRoot);
  return relativePluginRoot !== "" && !relativePluginRoot.startsWith("..") && !isAbsolute(relativePluginRoot);
}

async function readPluginManifest(manifestPath: string): Promise<PluginManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8")) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * Resolves the bundled local marketplace without touching a user's Codex home.
 * Materialization and managed configuration remain separate management commands.
 */
export async function resolvePackagedOmcsMarketplace(
  packageRoot: string,
): Promise<PackagedOmcsMarketplace | null> {
  const marketplacePath = join(packageRoot, ".agents", "plugins", "marketplace.json");
  if (!existsSync(marketplacePath)) return null;

  let marketplace: MarketplaceManifest;
  try {
    marketplace = JSON.parse(await readFile(marketplacePath, "utf8")) as MarketplaceManifest;
  } catch {
    return null;
  }

  if (marketplace.name !== OMCS_LOCAL_MARKETPLACE_NAME) return null;
  const entry = marketplace.plugins?.find(
    (candidate) => candidate.name === OMCS_PLUGIN_NAME
      && candidate.source?.source === "local"
      && typeof candidate.source.path === "string",
  );
  if (!entry || typeof entry.source?.path !== "string") return null;

  const pluginRoot = resolve(packageRoot, entry.source.path);
  if (!pluginRootStaysInPackage(packageRoot, pluginRoot)) return null;
  const pluginManifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
  const manifest = await readPluginManifest(pluginManifestPath);
  if (manifest?.name !== OMCS_PLUGIN_NAME || manifest.skills !== "./skills/") return null;

  return { marketplacePath, packageRoot, pluginRoot, pluginManifestPath };
}

export function omcsPluginCacheBase(codexHomeDir: string): string {
  return join(codexHomeDir, "plugins", "cache", OMCS_LOCAL_MARKETPLACE_NAME, OMCS_PLUGIN_NAME);
}

/** Lists only local cache directories whose manifest declares the OMCS plugin. */
export async function discoverOmcsPluginCacheDirs(codexHomeDir: string): Promise<string[]> {
  const cacheRoot = join(codexHomeDir, "plugins", "cache");
  if (!existsSync(cacheRoot)) return [];

  const queue: Array<{ path: string; depth: number }> = [{ path: cacheRoot, depth: 0 }];
  const matches: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const manifest = await readPluginManifest(join(current.path, ".codex-plugin", "plugin.json"));
    if (manifest?.name === OMCS_PLUGIN_NAME) {
      matches.push(current.path);
      continue;
    }
    if (current.depth >= 5) continue;
    const entries = await readdir(current.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return matches.sort();
}
