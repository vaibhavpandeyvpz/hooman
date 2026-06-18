import type { Config } from "../config.js";
import { System, type SystemMode } from "./system.js";

export { System };

export async function system(
  path: string,
  config: Config,
  mode: SystemMode = "default",
): Promise<System> {
  const prompt = new System(path, config, mode);
  await prompt.reload();
  return prompt;
}
