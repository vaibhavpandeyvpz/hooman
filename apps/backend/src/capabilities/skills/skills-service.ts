import {
  listSkillsFromFs,
  getSkillContent,
  addSkill,
  removeSkills,
  type SkillEntry,
  type SkillsRunResult,
} from "./skills-cli.js";

export interface SkillService {
  list(): Promise<SkillEntry[]>;
  getContent(id: string): Promise<string | null>;
  add(options: {
    package: string;
    skills?: string[];
  }): Promise<SkillsRunResult>;
  remove(skillNames: string[]): Promise<SkillsRunResult>;
}

export function createSkillService(): SkillService {
  return {
    async list() {
      return listSkillsFromFs();
    },
    async getContent(id: string) {
      return getSkillContent(id);
    },
    async add(options) {
      return addSkill(options);
    },
    async remove(skillNames) {
      return removeSkills(skillNames);
    },
  };
}
