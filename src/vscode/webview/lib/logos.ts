import anthropic from "../assets/logos/anthropic.svg?raw";
import openai from "../assets/logos/openai.svg?raw";
import google from "../assets/logos/google.svg?raw";
import llamacpp from "../assets/logos/llamacpp.svg?raw";
import mlx from "../assets/logos/mlx.svg?raw";
import ollama from "../assets/logos/ollama.svg?raw";
import amazonwebservices from "../assets/logos/amazonwebservices.svg?raw";
import microsoftazure from "../assets/logos/microsoftazure.svg?raw";
import groq from "../assets/logos/groq.svg?raw";
import openrouter from "../assets/logos/openrouter.svg?raw";
import x from "../assets/logos/x.svg?raw";
import moonshot from "../assets/logos/moonshot.svg?raw";
import minimax from "../assets/logos/minimax.svg?raw";
import duckduckgo from "../assets/logos/duckduckgo.svg?raw";
import brave from "../assets/logos/brave.svg?raw";
import exa from "../assets/logos/exa.svg?raw";
import firecrawl from "../assets/logos/firecrawl.svg?raw";
import litellm from "../assets/logos/litellm.svg?raw";
import serper from "../assets/logos/serper.svg?raw";
import tavily from "../assets/logos/tavily.svg?raw";
import type { ProviderKind, SearchProvider } from "../../src/shared/settings";

const PROVIDER_LOGOS: Record<ProviderKind, string> = {
  anthropic,
  openai,
  google,
  "llama-cpp": llamacpp,
  mlx,
  ollama,
  bedrock: amazonwebservices,
  azure: microsoftazure,
  groq,
  openrouter,
  xai: x,
  moonshot,
  minimax,
};

const SEARCH_LOGOS: Record<SearchProvider, string> = {
  duckduckgo,
  brave,
  exa,
  firecrawl,
  litellm,
  serper,
  tavily,
};

export function providerLogoSvg(kind: ProviderKind): string {
  return PROVIDER_LOGOS[kind];
}

export function searchLogoSvg(kind: SearchProvider): string {
  return SEARCH_LOGOS[kind];
}
