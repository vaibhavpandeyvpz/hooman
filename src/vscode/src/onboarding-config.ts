import { existsSync } from "node:fs";
import {
  completeOnboardingConfig as completeShared,
  validateOnboardingProvider as validateShared,
  validateOnboardingSearch as validateSharedSearch,
  type OnboardingInput as SharedOnboardingInput,
  type OnboardingProviderId,
  type OnboardingProviderInput as SharedProviderInput,
  type OnboardingSearchProvider,
} from "../../core/utils/onboarding-config";
import type { ProviderKind, SearchProvider } from "./shared/settings";
import { homeConfigPath } from "./settings-utils";

export type OnboardingInput = {
  provider: ProviderKind;
  providerOptions: Record<string, string>;
  azureDeployment?: string;
  searchProvider: SearchProvider;
  searchOptions: Record<string, string>;
};

export type OnboardingProviderInput = {
  provider: ProviderKind;
  providerOptions: Record<string, string>;
  azureDeployment?: string;
};

/** Whether first-run onboarding should be skipped for the chat panel. */
export function shouldSkipOnboarding(): boolean {
  return existsSync(homeConfigPath());
}

/** Validate provider credentials via the list endpoint (throws on failure). */
export async function validateOnboardingProvider(
  input: OnboardingProviderInput,
): Promise<void> {
  await validateShared(toSharedProviderInput(input));
}

/**
 * Validate required credentials via the provider list endpoint, then write
 * `~/.hooman/config.json`. Throws (surfaced in the webview) if validation fails.
 */
export async function completeOnboardingConfig(
  input: OnboardingInput,
  onStatus?: (phase: "listing" | "writing", message?: string) => void,
): Promise<void> {
  await completeShared(toSharedInput(input), onStatus, homeConfigPath());
}

/** Probe the selected search provider with a one-result test query. */
export async function validateOnboardingSearch(
  provider: SearchProvider,
  options: Record<string, string>,
): Promise<void> {
  await validateSharedSearch(provider as OnboardingSearchProvider, options);
}

function toSharedProviderInput(
  input: OnboardingProviderInput,
): SharedProviderInput {
  return {
    provider: input.provider as OnboardingProviderId,
    providerOptions: input.providerOptions,
    azureDeployment: input.azureDeployment,
  };
}

function toSharedInput(input: OnboardingInput): SharedOnboardingInput {
  return {
    provider: input.provider as OnboardingProviderId,
    providerOptions: input.providerOptions,
    azureDeployment: input.azureDeployment,
    searchProvider: input.searchProvider as OnboardingSearchProvider,
    searchOptions: input.searchOptions,
  };
}
