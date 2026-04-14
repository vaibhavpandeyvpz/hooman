import type { Config } from "../config.ts";
import type { Registry } from "../skills/registry.ts";
import type { Toolkit } from "../toolkit.ts";
import { Skills } from "./skills.ts";
import { System } from "./system.ts";

export { Skills, System };

export async function system(
  path: string,
  config: Config,
  toolkit: Toolkit,
): Promise<System> {
  const prompt = new System(path, config, toolkit);
  await prompt.reload();
  return prompt;
}

export async function skills(registry: Registry): Promise<Skills> {
  const prompt = new Skills(registry);
  await prompt.reload();
  return prompt;
}
