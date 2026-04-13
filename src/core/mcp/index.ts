import { Config } from "./config.ts";
import { Manager } from "./manager.ts";

export { Config, Manager };
export { createMcpTools } from "./tools.ts";

export function createMcpConfig(path: string): Config {
  return new Config(path);
}

export function createMcpManager(config: Config): Manager {
  return new Manager(config);
}
