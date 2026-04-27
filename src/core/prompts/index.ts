import type { Config } from "../config.js";
import type { Registry } from "../skills/registry.js";
import { Skills } from "./skills.js";
import { System, type SystemMode } from "./system.js";

export { Skills, System };

export async function system(
  path: string,
  config: Config,
  mode: SystemMode = "default",
): Promise<System> {
  const prompt = new System(path, config, mode);
  await prompt.reload();
  return prompt;
}

export async function skills(registry: Registry): Promise<Skills> {
  const prompt = new Skills(registry);
  await prompt.reload();
  return prompt;
}
