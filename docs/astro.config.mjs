// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://vaibhavpandey.com",
  base: "/hooman",
  trailingSlash: "ignore",
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: "Hooman",
      logo: {
        src: "./src/assets/logo.svg",
        replacesTitle: false,
      },
      favicon: "/favicon.svg",
      customCss: ["./src/styles/starlight.css"],
      expressiveCode: {
        themes: ["github-dark-default"],
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/vaibhavpandeyvpz/hooman",
        },
        {
          icon: "seti:npm",
          label: "npm",
          href: "https://www.npmjs.com/package/hoomanjs",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/vaibhavpandeyvpz/hooman/edit/main/docs/",
      },
      sidebar: [
        {
          label: "Start Here",
          items: [
            { label: "Getting Started", slug: "getting-started" },
            { label: "CLI", slug: "quickstart-cli" },
            { label: "VS Code", slug: "quickstart-vscode" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "CLI", slug: "guides/cli" },
            { label: "VS Code", slug: "guides/vscode" },
            { label: "ACP", slug: "guides/acp" },
            {
              label: "Configuration",
              items: [
                { label: "Overview", slug: "guides/configuration" },
                {
                  label: "Models",
                  items: [
                    { label: "Overview", slug: "guides/configuration/models" },
                    {
                      label: "Anthropic",
                      slug: "guides/configuration/models/anthropic",
                    },
                    {
                      label: "Azure",
                      slug: "guides/configuration/models/azure",
                    },
                    {
                      label: "Bedrock",
                      slug: "guides/configuration/models/bedrock",
                    },
                    {
                      label: "Google",
                      slug: "guides/configuration/models/google",
                    },
                    { label: "Groq", slug: "guides/configuration/models/groq" },
                    {
                      label: "llama.cpp",
                      slug: "guides/configuration/models/llama-cpp",
                    },
                    {
                      label: "MiniMax",
                      slug: "guides/configuration/models/minimax",
                    },
                    {
                      label: "MLX",
                      slug: "guides/configuration/models/mlx",
                    },
                    {
                      label: "Moonshot",
                      slug: "guides/configuration/models/moonshot",
                    },
                    {
                      label: "Ollama",
                      slug: "guides/configuration/models/ollama",
                    },
                    {
                      label: "OpenAI",
                      slug: "guides/configuration/models/openai",
                    },
                    {
                      label: "OpenRouter",
                      slug: "guides/configuration/models/openrouter",
                    },
                    { label: "xAI", slug: "guides/configuration/models/xai" },
                  ],
                },
                {
                  label: "Search",
                  items: [
                    { label: "Overview", slug: "guides/configuration/search" },
                    {
                      label: "Brave",
                      slug: "guides/configuration/search/brave",
                    },
                    { label: "Exa", slug: "guides/configuration/search/exa" },
                    {
                      label: "Firecrawl",
                      slug: "guides/configuration/search/firecrawl",
                    },
                    {
                      label: "LiteLLM",
                      slug: "guides/configuration/search/litellm",
                    },
                    {
                      label: "Serper",
                      slug: "guides/configuration/search/serper",
                    },
                    {
                      label: "Tavily",
                      slug: "guides/configuration/search/tavily",
                    },
                  ],
                },
                { label: "Prompts", slug: "guides/configuration/prompts" },
                { label: "Tools", slug: "guides/configuration/tools" },
                {
                  label: "Compaction",
                  slug: "guides/configuration/compaction",
                },
              ],
            },
            {
              label: "MCP",
              items: [
                { label: "Overview", slug: "guides/mcp" },
                { label: "Channels", slug: "guides/mcp/channels" },
              ],
            },
            { label: "Skills", slug: "guides/skills" },
            { label: "Tools", slug: "guides/tools" },
          ],
        },
        {
          label: "Project",
          items: [{ label: "Development", slug: "development" }],
        },
      ],
      pagination: true,
    }),
  ],
});
