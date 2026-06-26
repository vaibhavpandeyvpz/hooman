import { basename, resolve } from "node:path";
import { Config, type ConfigOptions } from "./config.js";
import { Config as McpConfig } from "./mcp/config.js";
import { configJsonPath, mcpJsonPath } from "./utils/paths.js";
import { discoverWalkUpFiles } from "./utils/discover-files.js";

export type RuntimeConfigSources = {
  config: { primaryPath: string; overlayPaths: string[] };
  mcp: { primaryPath: string; overlayPaths: string[] };
};

function overlayPathsFor(
  filename: string,
  primaryPath: string,
  cwd: string = process.cwd(),
): string[] {
  const primaryResolved = resolve(primaryPath);
  return discoverWalkUpFiles(filename, cwd)
    .map((path) => resolve(path))
    .filter((path) => path !== primaryResolved);
}

export function runtimeConfigOptions(
  cwd: string = process.cwd(),
): ConfigOptions {
  const path = configJsonPath();
  return {
    overlayPaths: overlayPathsFor(basename(path), path, cwd),
  };
}

export function runtimeConfigSources(
  cwd: string = process.cwd(),
): RuntimeConfigSources {
  const configPath = configJsonPath();
  const mcpPath = mcpJsonPath();
  return {
    config: {
      primaryPath: configPath,
      overlayPaths: overlayPathsFor(basename(configPath), configPath, cwd),
    },
    mcp: {
      primaryPath: mcpPath,
      overlayPaths: overlayPathsFor(basename(mcpPath), mcpPath, cwd),
    },
  };
}

export function createRuntimeConfig(cwd: string = process.cwd()): Config {
  const sources = runtimeConfigSources(cwd);
  return new Config(sources.config.primaryPath, {
    overlayPaths: sources.config.overlayPaths,
  });
}

export function createRuntimeMcpConfig(cwd: string = process.cwd()): McpConfig {
  const sources = runtimeConfigSources(cwd);
  return new McpConfig(sources.mcp.primaryPath, {
    overlayPaths: sources.mcp.overlayPaths,
  });
}
