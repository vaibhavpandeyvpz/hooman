import type { Config } from "../config.ts";
import type { Registry } from "../skills/registry.ts";
import { Skills } from "./skills.ts";
import { System, type SystemMode } from "./system.ts";

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
