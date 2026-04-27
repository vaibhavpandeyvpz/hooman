import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import type { Registry } from "./registry.js";

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export function create(registry: Registry) {
  return [
    tool({
      name: "list_skills",
      description:
        "List currently installed skills available to the local agent.",
      inputSchema: z.object({}),
      callback: async () => {
        const skills = await registry.list();
        return toJsonValue({
          count: skills.length,
          skills,
        });
      },
    }),
    tool({
      name: "search_skills",
      description:
        "Search the public skills catalog for skills matching a query.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe("Search query for the public skills catalog."),
      }),
      callback: async (input) => {
        const results = await registry.search(input.query);
        return toJsonValue({
          count: results.length,
          results,
        });
      },
    }),
    tool({
      name: "install_skill",
      description:
        "Install a skill from a source such as owner/repo, a GitHub URL, or a local path.",
      inputSchema: z.object({
        source: z
          .string()
          .min(1)
          .describe("Skill source to install (repo, URL, or local path)."),
      }),
      callback: async (input) => {
        await registry.install(input.source);
        return toJsonValue({
          installed: true,
          source: input.source,
        });
      },
    }),
    tool({
      name: "delete_skill",
      description:
        "Delete an installed skill by its folder name under the local skills directory.",
      inputSchema: z.object({
        folder: z
          .string()
          .min(1)
          .describe("Installed skill folder name to remove."),
      }),
      callback: async (input) => {
        await registry.delete(input.folder);
        return toJsonValue({
          deleted: true,
          folder: input.folder,
        });
      },
    }),
  ];
}
