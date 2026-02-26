#!/usr/bin/env node
/**
 * Skills MCP server (stdio). Exposes read_skill and list_skills as MCP tools.
 * Reads from project .agents/skills (SKILLS_CWD). Only enabled skills are listed for the agent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { initSkillSettingsStore } from "../skills/skills-settings-store.js";
import { createSkillService } from "../skills/skills-service.js";

const settingsStore = await initSkillSettingsStore();
const skillService = createSkillService(settingsStore);

const server = new McpServer(
  { name: "hooman-skills", version: "1.0.0" },
  { capabilities: {} },
);

function textContent(text: string): { type: "text"; text: string }[] {
  return [{ type: "text" as const, text }];
}

server.registerTool(
  "list_skills",
  {
    title: "List installed skills",
    description:
      "List installed skills (by id, name, description). Use when you need to know which skills are available before reading one with read_skill.",
    inputSchema: z.object({}),
  },
  async () => {
    const skills = await skillService.listEnabled();
    if (skills.length === 0)
      return { content: textContent("No skills installed.") };
    return {
      content: textContent(
        JSON.stringify(
          skills.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description ? { description: s.description } : {}),
          })),
          null,
          2,
        ),
      ),
    };
  },
);

server.registerTool(
  "read_skill",
  {
    title: "Read skill instructions",
    description:
      "Read the full instructions (SKILL.md) for an installed skill by its id. Use when you need to follow a skill's procedures. Pass the skill_id (e.g. pptx, pdf, docx) from the available skills list.",
    inputSchema: z.object({
      skill_id: z
        .string()
        .describe("The skill id (directory name, e.g. pptx, pdf, docx)"),
    }),
  },
  async (args) => {
    const skillId = args?.skill_id?.trim() ?? "";
    if (!skillId)
      return { content: textContent("Error: skill_id is required.") };
    const content = await skillService.getContent(skillId);
    return {
      content: textContent(content ?? "Skill not found."),
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
