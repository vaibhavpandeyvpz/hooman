import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  PROVIDER_DISPLAY_NAMES,
  SEARCH_PROVIDER_LABELS,
  SEARCH_PROVIDERS,
  SUPPORTED_PROVIDER_TYPES,
  type ProviderKind,
  type SearchProvider,
} from "../../src/shared/settings";
import { post } from "../lib/vscode-api";
import { providerLogoSvg, searchLogoSvg } from "../lib/logos";
import {
  onboardingBusy,
  onboardingError,
  openLink,
  setState,
  state,
} from "../store";
import HoomanLogo from "./HoomanLogo";

type Step = 1 | 2;

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
  required?: boolean;
  helpHref?: string;
  helpLabel?: string;
};

function providerFields(kind: ProviderKind): FieldDef[] {
  switch (kind) {
    case "llama-cpp":
    case "mlx":
      return [];
    case "ollama":
      return [
        {
          key: "baseURL",
          label: "Base URL",
          placeholder: "http://127.0.0.1:11434",
        },
      ];
    case "azure":
      return [
        {
          key: "baseURL",
          label: "Base URL",
          placeholder: "https://your-resource.openai.azure.com/openai",
          required: true,
        },
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://ai.azure.com/",
          helpLabel: "Get it here",
        },
        {
          key: "deployment",
          label: "Deployment name",
          placeholder: "gpt-5.4-mini",
          required: true,
        },
      ];
    case "bedrock":
      return [
        {
          key: "region",
          label: "Region",
          placeholder: "us-west-2",
          required: true,
        },
        {
          key: "profile",
          label: "AWS profile",
          placeholder: "default",
          required: true,
          helpHref:
            "https://console.aws.amazon.com/iam/home?region=us-east-1#/users",
          helpLabel: "Manage IAM users",
        },
      ];
    case "google":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://aistudio.google.com/api-keys",
          helpLabel: "Get it here",
        },
      ];
    case "anthropic":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "sk-ant-...",
          sensitive: true,
          required: true,
          helpHref:
            "https://platform.claude.com/settings/workspaces/default/keys",
          helpLabel: "Get it here",
        },
      ];
    case "openai":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "sk-...",
          sensitive: true,
          required: true,
          helpHref: "https://platform.openai.com/api-keys",
          helpLabel: "Get it here",
        },
      ];
    case "groq":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "gsk_...",
          sensitive: true,
          required: true,
          helpHref: "https://console.groq.com/keys",
          helpLabel: "Get it here",
        },
      ];
    case "minimax":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://platform.minimax.io/console/access",
          helpLabel: "Get it here",
        },
      ];
    case "xai":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://console.x.ai/team/default/api-keys",
          helpLabel: "Get it here",
        },
      ];
    case "openrouter":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://openrouter.ai/workspaces/default/keys",
          helpLabel: "Get it here",
        },
      ];
    case "moonshot":
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
          helpHref: "https://platform.moonshot.ai/",
          helpLabel: "Get it here",
        },
      ];
    default:
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
        },
      ];
  }
}

function searchFields(kind: SearchProvider): FieldDef[] {
  if (kind === "duckduckgo") {
    return [];
  }
  if (kind === "litellm") {
    return [
      {
        key: "baseURL",
        label: "Base URL",
        placeholder: "http://localhost:4000",
        required: true,
      },
      {
        key: "apiKey",
        label: "API key",
        placeholder: "...",
        sensitive: true,
        required: true,
      },
      {
        key: "tool",
        label: "Tool",
        placeholder: "perplexity-search",
        required: true,
      },
    ];
  }
  return [
    {
      key: "apiKey",
      label: "API key",
      placeholder: "...",
      sensitive: true,
      required: true,
    },
  ];
}

function fieldsFilled(
  fields: FieldDef[],
  values: Record<string, string>,
): boolean {
  return fields.every((field) => {
    if (!field.required) {
      return true;
    }
    return Boolean(values[field.key]?.trim());
  });
}

function initialProviderValues(kind: ProviderKind): Record<string, string> {
  if (kind === "bedrock") {
    return { region: "us-west-2", profile: "default" };
  }
  return {};
}

export default function OnboardingView() {
  const [step, setStep] = createSignal<Step>(1);
  const [provider, setProvider] = createSignal<ProviderKind>("llama-cpp");
  const [providerValues, setProviderValues] = createSignal<
    Record<string, string>
  >({});
  const [searchProvider, setSearchProvider] =
    createSignal<SearchProvider>("duckduckgo");
  const [searchValues, setSearchValues] = createSignal<Record<string, string>>(
    {},
  );

  const currentProviderFields = createMemo(() => providerFields(provider()));
  const currentSearchFields = createMemo(() => searchFields(searchProvider()));

  const canContinueStep1 = createMemo(() =>
    fieldsFilled(currentProviderFields(), providerValues()),
  );
  const canFinish = createMemo(
    () =>
      canContinueStep1() &&
      fieldsFilled(currentSearchFields(), searchValues()) &&
      !onboardingBusy(),
  );

  createEffect(() => {
    if (state.onboardingPhase === "validated") {
      setStep(2);
      setState("onboardingPhase", "idle");
      setState("onboardingMessage", null);
    }
  });

  function selectProvider(kind: ProviderKind): void {
    setProvider(kind);
    setProviderValues(initialProviderValues(kind));
    if (state.onboardingPhase === "error") {
      setState("onboardingPhase", "idle");
      setState("onboardingMessage", null);
    }
  }

  function selectSearch(kind: SearchProvider): void {
    setSearchProvider(kind);
    setSearchValues({});
    if (state.onboardingPhase === "error") {
      setState("onboardingPhase", "idle");
      setState("onboardingMessage", null);
    }
  }

  function setProviderField(key: string, value: string): void {
    setProviderValues((prev) => ({ ...prev, [key]: value }));
    if (state.onboardingPhase === "error") {
      setState("onboardingPhase", "idle");
      setState("onboardingMessage", null);
    }
  }

  function setSearchField(key: string, value: string): void {
    setSearchValues((prev) => ({ ...prev, [key]: value }));
    if (state.onboardingPhase === "error") {
      setState("onboardingPhase", "idle");
      setState("onboardingMessage", null);
    }
  }

  function providerPayload(): {
    provider: ProviderKind;
    providerOptions: Record<string, string>;
    azureDeployment?: string;
  } {
    const values = providerValues();
    const { deployment, ...providerOptions } = values;
    return {
      provider: provider(),
      providerOptions,
      ...(provider() === "azure" && deployment?.trim()
        ? { azureDeployment: deployment.trim() }
        : {}),
    };
  }

  function onContinue(): void {
    if (step() === 1) {
      if (!canContinueStep1() || onboardingBusy()) {
        return;
      }
      post({
        type: "validateOnboardingProvider",
        ...providerPayload(),
      });
      return;
    }
    if (!canFinish()) {
      return;
    }
    post({
      type: "completeOnboarding",
      ...providerPayload(),
      searchProvider: searchProvider(),
      searchOptions: searchValues(),
    });
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-background">
      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div class="mb-5 flex flex-col items-center gap-2 text-center">
          <HoomanLogo class="h-10 w-10 text-accent" />
          <div>
            <h1 class="text-sm font-semibold text-foreground">
              Welcome to Hooman
            </h1>
            <p class="mt-0.5 text-[11.5px] text-muted">
              {step() === 1
                ? "Choose an inference provider to get started."
                : "Choose how Hooman searches the web."}
            </p>
          </div>
        </div>

        <Show when={step() === 1}>
          <div
            class="mx-auto grid justify-center gap-2"
            style={{
              "grid-template-columns": "repeat(auto-fill, 72px)",
              "max-width": "100%",
            }}
          >
            <For each={SUPPORTED_PROVIDER_TYPES}>
              {(kind) => (
                <ProviderTile
                  kind={kind}
                  selected={provider() === kind}
                  onSelect={() => selectProvider(kind)}
                />
              )}
            </For>
          </div>
          <Show when={currentProviderFields().length > 0}>
            <div class="mt-4 flex flex-col gap-2.5">
              <For each={currentProviderFields()}>
                {(field) => (
                  <div class="flex flex-col gap-1">
                    <label class="flex flex-col gap-1">
                      <span class="text-[11px] font-medium text-muted">
                        {field.label}
                        <Show when={field.required}>
                          <span class="text-error"> *</span>
                        </Show>
                      </span>
                      <input
                        class="box-border h-8 w-full rounded-md border border-input-border bg-input px-2.5 text-xs text-input-foreground outline-none focus:border-focus"
                        type={field.sensitive ? "password" : "text"}
                        placeholder={field.placeholder}
                        value={providerValues()[field.key] ?? ""}
                        onInput={(event) =>
                          setProviderField(field.key, event.currentTarget.value)
                        }
                        autocomplete="off"
                        spellcheck={false}
                      />
                    </label>
                    <Show when={field.helpHref}>
                      {(href) => (
                        <p class="text-[11px] text-muted">
                          {field.helpLabel ?? "Get it here"}:{" "}
                          <button
                            type="button"
                            class="text-accent underline-offset-2 hover:underline"
                            onClick={() => openLink(href())}
                          >
                            {href()}
                          </button>
                        </p>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={step() === 2}>
          <div
            class="mx-auto grid justify-center gap-2"
            style={{
              "grid-template-columns": "repeat(auto-fill, 72px)",
              "max-width": "100%",
            }}
          >
            <For each={SEARCH_PROVIDERS}>
              {(kind) => (
                <SearchTile
                  kind={kind}
                  selected={searchProvider() === kind}
                  onSelect={() => selectSearch(kind)}
                />
              )}
            </For>
          </div>
          <Show when={currentSearchFields().length > 0}>
            <div class="mt-4 flex flex-col gap-2.5">
              <For each={currentSearchFields()}>
                {(field) => (
                  <label class="flex flex-col gap-1">
                    <span class="text-[11px] font-medium text-muted">
                      {field.label}
                      <Show when={field.required}>
                        <span class="text-error"> *</span>
                      </Show>
                    </span>
                    <input
                      class="box-border h-8 w-full rounded-md border border-input-border bg-input px-2.5 text-xs text-input-foreground outline-none focus:border-focus"
                      type={field.sensitive ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={searchValues()[field.key] ?? ""}
                      onInput={(event) =>
                        setSearchField(field.key, event.currentTarget.value)
                      }
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </label>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={onboardingError()}>
          {(message) => (
            <p class="mt-3 rounded-md border border-error/40 bg-error/10 px-2.5 py-2 text-[11.5px] text-error">
              {message()}
            </p>
          )}
        </Show>
      </div>

      <div class="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3">
        <p class="text-center text-[11px] text-muted">
          Advanced settings are available later in Hooman settings.
        </p>
        <div class="flex items-center gap-2">
          <div class="flex flex-1 items-center gap-1.5">
            <span
              class={`h-1.5 w-1.5 rounded-full ${step() === 1 ? "bg-accent" : "bg-muted/50"}`}
            />
            <span
              class={`h-1.5 w-1.5 rounded-full ${step() === 2 ? "bg-accent" : "bg-muted/50"}`}
            />
          </div>
          <Show when={step() === 2}>
            <button
              type="button"
              class="btn btn-secondary h-8 px-3 text-xs"
              disabled={onboardingBusy()}
              onClick={() => setStep(1)}
            >
              Back
            </button>
          </Show>
          <button
            type="button"
            class="btn btn-primary h-8 px-3 text-xs"
            disabled={
              step() === 1
                ? !canContinueStep1() || onboardingBusy()
                : !canFinish()
            }
            onClick={onContinue}
          >
            {onboardingBusy()
              ? "Validating…"
              : step() === 1
                ? "Continue"
                : "Get started"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderTile(props: {
  kind: ProviderKind;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      class={`box-border flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-md border px-1 text-center transition-colors ${
        props.selected
          ? "border-focus bg-accent/10 text-foreground"
          : "border-border bg-panel/40 text-muted hover:border-focus/60 hover:text-foreground"
      }`}
      onClick={props.onSelect}
    >
      <span
        class="brand-logo flex h-6 w-6 shrink-0 items-center justify-center text-current"
        innerHTML={providerLogoSvg(props.kind)}
      />
      <span class="max-w-full truncate px-0.5 text-[9px] font-medium leading-tight">
        {PROVIDER_DISPLAY_NAMES[props.kind]}
      </span>
    </button>
  );
}

function SearchTile(props: {
  kind: SearchProvider;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      class={`box-border flex h-[72px] w-[72px] flex-col items-center justify-center gap-1 rounded-md border px-1 text-center transition-colors ${
        props.selected
          ? "border-focus bg-accent/10 text-foreground"
          : "border-border bg-panel/40 text-muted hover:border-focus/60 hover:text-foreground"
      }`}
      onClick={props.onSelect}
    >
      <span
        class="brand-logo flex h-6 w-6 shrink-0 items-center justify-center text-current"
        innerHTML={searchLogoSvg(props.kind)}
      />
      <span class="max-w-full truncate px-0.5 text-[9px] font-medium leading-tight">
        {SEARCH_PROVIDER_LABELS[props.kind]}
      </span>
    </button>
  );
}
