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
        { icon: "github", label: "GitHub", href: "https://github.com/vaibhavpandeyvpz/hooman" },
        { icon: "seti:npm", label: "npm", href: "https://www.npmjs.com/package/hoomanjs" },
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
            { label: "Configuration", slug: "guides/configuration" },
            { label: "Providers & Models", slug: "guides/providers" },
            { label: "MCP", slug: "guides/mcp" },
            { label: "Skills", slug: "guides/skills" },
            { label: "Tools & Approvals", slug: "guides/tools-and-approvals" },
            { label: "VS Code Extension", slug: "guides/vscode" },
            { label: "ACP", slug: "guides/acp" },
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
