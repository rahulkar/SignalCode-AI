import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RawOwnershipConfig = {
  team?: string | null;
  author_id?: string | null;
  default_team?: string | null;
  default_author_id?: string | null;
};

type NormalizedOwnershipConfig = {
  team: string | null;
  authorId: string | null;
};

export type OwnershipContext = {
  service: string | null;
  team: string | null;
  authorId: string | null;
};

const EMPTY_CONFIG: NormalizedOwnershipConfig = { team: null, authorId: null };
const OWNERSHIP_FILENAMES = ["team.json", "teams.json"] as const;

const ownershipCache = new Map<string, { mtimeMs: number; config: NormalizedOwnershipConfig }>();

export function resolveOwnershipContext(
  filePaths: string[],
  derivedService: string | null,
  projectRootPath: string | null = null
): OwnershipContext {
  const config = readOwnershipConfigForContext(filePaths, projectRootPath);

  return {
    service: derivedService,
    team: config.team,
    authorId: config.authorId
  };
}

export function listConfiguredTeams(): string[] {
  const configPath = resolveConfiguredOrDefaultConfigPath();
  const config = configPath ? readOwnershipConfigFromPath(configPath) : EMPTY_CONFIG;
  return config.team ? [config.team] : [];
}

function readOwnershipConfigForContext(filePaths: string[], projectRootPath: string | null): NormalizedOwnershipConfig {
  const configuredPath = resolveConfiguredConfigPath();
  if (configuredPath && existsSync(configuredPath)) {
    return readOwnershipConfigFromPath(configuredPath);
  }

  const contextPath = resolveContextConfigPath(filePaths, projectRootPath);
  if (contextPath) {
    return readOwnershipConfigFromPath(contextPath);
  }

  const defaultPath = resolveDefaultConfigPath();
  if (defaultPath && existsSync(defaultPath)) {
    return readOwnershipConfigFromPath(defaultPath);
  }

  return EMPTY_CONFIG;
}

function resolveConfiguredConfigPath(): string | null {
  const configured = process.env.TEAM_CONFIG_PATH?.trim() || process.env.TEAMS_CONFIG_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return null;
}

function resolveConfiguredOrDefaultConfigPath(): string | null {
  return resolveConfiguredConfigPath() ?? resolveDefaultConfigPath();
}

function resolveDefaultConfigPath(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...OWNERSHIP_FILENAMES.map((name) => path.resolve(process.cwd(), name)),
    ...OWNERSHIP_FILENAMES.map((name) => path.resolve(process.cwd(), "..", name)),
    ...OWNERSHIP_FILENAMES.map((name) => path.resolve(moduleDir, "..", "..", name))
  ];
  const dedupedCandidates = [...new Set(candidates)];
  return dedupedCandidates.find((candidate) => existsSync(candidate)) ?? dedupedCandidates[0] ?? null;
}

function resolveContextConfigPath(filePaths: string[], projectRootPath: string | null): string | null {
  const startDirs: string[] = [];

  const normalizedProjectRoot = normalizeOptionalString(projectRootPath);
  if (normalizedProjectRoot && path.isAbsolute(normalizedProjectRoot)) {
    startDirs.push(coerceToSearchDirectory(path.resolve(normalizedProjectRoot)));
  }

  for (const filePath of filePaths) {
    const absolutePath = resolveAbsolutePathForLookup(filePath, normalizedProjectRoot);
    if (!absolutePath) {
      continue;
    }
    startDirs.push(coerceToSearchDirectory(absolutePath));
  }

  const dedupedStartDirs = [...new Set(startDirs)];
  for (const startDir of dedupedStartDirs) {
    const found = findNearestOwnershipFile(startDir);
    if (found) {
      return found;
    }
  }
  return null;
}

function resolveAbsolutePathForLookup(filePath: string, projectRootPath: string | null): string | null {
  const normalized = normalizeOptionalString(filePath);
  if (!normalized) {
    return null;
  }
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }
  if (projectRootPath && path.isAbsolute(projectRootPath)) {
    return path.resolve(projectRootPath, normalized);
  }
  return null;
}

function coerceToSearchDirectory(candidatePath: string): string {
  if (existsSync(candidatePath)) {
    try {
      const stat = statSync(candidatePath);
      return stat.isDirectory() ? candidatePath : path.dirname(candidatePath);
    } catch {
      return path.dirname(candidatePath);
    }
  }

  const looksLikeFile = path.extname(candidatePath).length > 0;
  return looksLikeFile ? path.dirname(candidatePath) : candidatePath;
}

function findNearestOwnershipFile(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    for (const fileName of OWNERSHIP_FILENAMES) {
      const candidate = path.join(current, fileName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

function readOwnershipConfigFromPath(configPath: string): NormalizedOwnershipConfig {
  if (!existsSync(configPath)) {
    return EMPTY_CONFIG;
  }

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(configPath);
  } catch {
    return EMPTY_CONFIG;
  }
  const cached = ownershipCache.get(configPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.config;
  }

  const config = parseOwnershipConfig(configPath);
  ownershipCache.set(configPath, { mtimeMs: stat.mtimeMs, config });
  return config;
}

function parseOwnershipConfig(configPath: string): NormalizedOwnershipConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as RawOwnershipConfig;
    return {
      team: firstNonEmpty(normalizeOptionalString(parsed.team), normalizeOptionalString(parsed.default_team)),
      authorId: firstNonEmpty(normalizeOptionalString(parsed.author_id), normalizeOptionalString(parsed.default_author_id))
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}
