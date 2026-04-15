import { Config, type NamedMcpTransport } from "./config.ts";
import { Manager } from "./manager.ts";

export { Config, Manager };
export type { NamedMcpTransport };
export { createMcpTools } from "./tools.ts";

export function createMcpConfig(path: string): Config {
  return new Config(path);
}

export function createMcpManager(
  config: Config,
  mcpServers: readonly NamedMcpTransport[] = [],
): Manager {
  return new Manager(config, mcpServers);
}
