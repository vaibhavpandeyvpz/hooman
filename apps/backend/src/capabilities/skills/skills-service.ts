import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
  type SkillEntry,
  type SkillsRunResult,
} from "./skills-cli.js";
import type { SkillSettingsStore } from "./skills-settings-store.js";

export interface SkillEntryWithEnabled extends SkillEntry {
  enabled: boolean;
}

export interface SkillService {
  list(): Promise<SkillEntry[]>;
  /** All skills from FS with enabled flag from store (default true when missing). */
  listWithEnabled(): Promise<SkillEntryWithEnabled[]>;
  /** Only skills that are enabled (for agent use). */
  listEnabled(): Promise<SkillEntry[]>;
  getContent(id: string): Promise<string | null>;
  /** Formatted "Available skills" section for agent system prompt (name + description per skill). Only includes enabled skills. */
  getSkillsMetadataSection(): Promise<string>;
  add(options: {
    package: string;
    skills?: string[];
  }): Promise<SkillsRunResult>;
  remove(skillNames: string[]): Promise<SkillsRunResult>;
}

export function createSkillService(
  settingsStore?: SkillSettingsStore | null,
): SkillService {
  return {
    async list() {
      return listSkillsFromFs();
    },
    async listWithEnabled(): Promise<SkillEntryWithEnabled[]> {
      const skills = await listSkillsFromFs();
      const settings = settingsStore ? await settingsStore.getAll() : {};
      return skills.map((s) => ({
        ...s,
        enabled: settings[s.id] ?? true,
      }));
    },
    async listEnabled(): Promise<SkillEntry[]> {
      const withEnabled = await this.listWithEnabled();
      return withEnabled
        .filter((s) => s.enabled)
        .map(({ enabled: _e, ...s }) => s);
    },
    async getContent(id: string) {
      return getSkillContent(id);
    },
    async getSkillsMetadataSection() {
      const skills = await this.listEnabled();
      if (skills.length === 0) return "";
      const lines = skills.map(
        (s) => `- **${s.name}**: ${s.description?.trim() || "No description."}`,
      );
      return `\n\nAvailable skills (use when relevant):\n${lines.join("\n")}`;
    },
    async add(options) {
      return addSkill(options);
    },
    async remove(skillNames) {
      return removeSkills(skillNames);
    },
  };
}
