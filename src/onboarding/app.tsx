import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { theme } from "../core/theme.js";
import { SelectMenuItem } from "../configure/components/SelectMenuItem.js";
import { ASCII_ART } from "../chat/components/ascii-logo.js";
import {
  completeOnboardingConfig,
  initialOnboardingProviderValues,
  ONBOARDING_PROVIDER_LABELS,
  ONBOARDING_PROVIDERS,
  ONBOARDING_SEARCH_LABELS,
  ONBOARDING_SEARCH_PROVIDERS,
  onboardingProviderFields,
  onboardingSearchFields,
  validateOnboardingProvider,
  type OnboardingFieldDef,
  type OnboardingProviderId,
  type OnboardingSearchProvider,
} from "../core/utils/onboarding-config.js";

type Step =
  | "pick-provider"
  | "provider-fields"
  | "validating-provider"
  | "pick-search"
  | "search-fields"
  | "finishing"
  | "done";

export function OnboardingApp(props: {
  onComplete: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("pick-provider");
  const [provider, setProvider] = useState<OnboardingProviderId>("llama-cpp");
  const [providerValues, setProviderValues] = useState<Record<string, string>>(
    {},
  );
  const [providerFieldIndex, setProviderFieldIndex] = useState(0);
  const [searchProvider, setSearchProvider] =
    useState<OnboardingSearchProvider>("duckduckgo");
  const [searchValues, setSearchValues] = useState<Record<string, string>>({});
  const [searchFieldIndex, setSearchFieldIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");

  const providerFields = useMemo(
    () => onboardingProviderFields(provider),
    [provider],
  );
  const searchFields = useMemo(
    () => onboardingSearchFields(searchProvider),
    [searchProvider],
  );

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      props.onCancel();
      exit();
      return;
    }
    if (step === "validating-provider" || step === "finishing") {
      return;
    }
    if (key.escape) {
      if (step === "provider-fields") {
        if (providerFieldIndex > 0) {
          const prev = providerFieldIndex - 1;
          setProviderFieldIndex(prev);
          setFieldDraft(providerValues[providerFields[prev]?.key ?? ""] ?? "");
          setError(null);
          return;
        }
        setStep("pick-provider");
        setError(null);
        return;
      }
      if (step === "pick-search") {
        setStep("pick-provider");
        setError(null);
        return;
      }
      if (step === "search-fields") {
        if (searchFieldIndex > 0) {
          const prev = searchFieldIndex - 1;
          setSearchFieldIndex(prev);
          setFieldDraft(searchValues[searchFields[prev]?.key ?? ""] ?? "");
          setError(null);
          return;
        }
        setStep("pick-search");
        setError(null);
        return;
      }
      if (step === "pick-provider") {
        props.onCancel();
        exit();
      }
    }
  });

  useEffect(() => {
    if (step !== "validating-provider") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { deployment, ...providerOptions } = providerValues;
        await validateOnboardingProvider({
          provider,
          providerOptions,
          ...(provider === "azure" && deployment?.trim()
            ? { azureDeployment: deployment.trim() }
            : {}),
        });
        if (cancelled) {
          return;
        }
        setError(null);
        setStatus(null);
        setStep("pick-search");
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus(null);
        setStep(
          providerFields.length > 0 ? "provider-fields" : "pick-provider",
        );
        if (providerFields.length > 0) {
          setProviderFieldIndex(0);
          setFieldDraft(providerValues[providerFields[0]?.key ?? ""] ?? "");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, provider, providerValues, providerFields]);

  useEffect(() => {
    if (step !== "finishing") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { deployment, ...providerOptions } = providerValues;
        await completeOnboardingConfig(
          {
            provider,
            providerOptions,
            ...(provider === "azure" && deployment?.trim()
              ? { azureDeployment: deployment.trim() }
              : {}),
            searchProvider,
            searchOptions: searchValues,
          },
          (_phase, message) => {
            if (!cancelled) {
              setStatus(message ?? null);
            }
          },
        );
        if (cancelled) {
          return;
        }
        setStep("done");
        props.onComplete();
        exit();
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus(null);
        setStep(searchFields.length > 0 ? "search-fields" : "pick-search");
        if (searchFields.length > 0) {
          setSearchFieldIndex(0);
          setFieldDraft(searchValues[searchFields[0]?.key ?? ""] ?? "");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    step,
    provider,
    providerValues,
    searchProvider,
    searchValues,
    searchFields,
    props,
    exit,
  ]);

  function beginProvider(next: OnboardingProviderId): void {
    setProvider(next);
    const initial = initialOnboardingProviderValues(next);
    setProviderValues(initial);
    setError(null);
    const fields = onboardingProviderFields(next);
    if (fields.length === 0) {
      setStep("validating-provider");
      setStatus("Validating credentials…");
      return;
    }
    setProviderFieldIndex(0);
    setFieldDraft(initial[fields[0]?.key ?? ""] ?? "");
    setStep("provider-fields");
  }

  function submitProviderField(value: string): void {
    const field = providerFields[providerFieldIndex];
    if (!field) {
      return;
    }
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      setError(`${field.label} is required.`);
      return;
    }
    const nextValues = { ...providerValues, [field.key]: trimmed };
    // Keep bedrock defaults if the user clears optional-looking blanks after edit.
    setProviderValues(nextValues);
    setError(null);
    const nextIndex = providerFieldIndex + 1;
    if (nextIndex < providerFields.length) {
      setProviderFieldIndex(nextIndex);
      setFieldDraft(nextValues[providerFields[nextIndex]?.key ?? ""] ?? "");
      return;
    }
    setStatus("Validating credentials…");
    setStep("validating-provider");
  }

  function beginSearch(next: OnboardingSearchProvider): void {
    setSearchProvider(next);
    setSearchValues({});
    setError(null);
    const fields = onboardingSearchFields(next);
    if (fields.length === 0) {
      setStatus("Writing config…");
      setStep("finishing");
      return;
    }
    setSearchFieldIndex(0);
    setFieldDraft("");
    setStep("search-fields");
  }

  function submitSearchField(value: string): void {
    const field = searchFields[searchFieldIndex];
    if (!field) {
      return;
    }
    const trimmed = value.trim();
    if (field.required && !trimmed) {
      setError(`${field.label} is required.`);
      return;
    }
    const nextValues = { ...searchValues, [field.key]: trimmed };
    setSearchValues(nextValues);
    setError(null);
    const nextIndex = searchFieldIndex + 1;
    if (nextIndex < searchFields.length) {
      setSearchFieldIndex(nextIndex);
      setFieldDraft(nextValues[searchFields[nextIndex]?.key ?? ""] ?? "");
      return;
    }
    setStatus("Validating search…");
    setStep("finishing");
  }

  const providerItems = ONBOARDING_PROVIDERS.map((id) => ({
    key: id,
    label: ONBOARDING_PROVIDER_LABELS[id],
    value: id,
  }));
  const searchItems = ONBOARDING_SEARCH_PROVIDERS.map((id) => ({
    key: id,
    label: ONBOARDING_SEARCH_LABELS[id],
    value: id,
  }));

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        {ASCII_ART.map((line) => (
          <Text key={line} color={theme.primary}>
            {line}
          </Text>
        ))}
        <Text bold>Welcome to Hooman</Text>
        <Text color={theme.muted}>
          {step === "pick-provider" ||
          step === "provider-fields" ||
          step === "validating-provider"
            ? "Choose an inference provider to get started."
            : "Choose how Hooman searches the web."}
        </Text>
      </Box>

      {error ? (
        <Box marginBottom={1}>
          <Text color={theme.error}>{error}</Text>
        </Box>
      ) : null}

      {status ? (
        <Box marginBottom={1}>
          <Text color={theme.secondary}>{status}</Text>
        </Box>
      ) : null}

      {step === "pick-provider" ? (
        <Box flexDirection="column">
          <SelectInput
            items={providerItems}
            itemComponent={SelectMenuItem}
            onSelect={(item) => beginProvider(item.value)}
          />
          <Box marginTop={1}>
            <Text color={theme.muted}>
              enter: select | esc: exit | ctrl+c: exit
            </Text>
          </Box>
        </Box>
      ) : null}

      {step === "provider-fields" ? (
        <FieldPrompt
          providerLabel={ONBOARDING_PROVIDER_LABELS[provider]}
          field={providerFields[providerFieldIndex]!}
          index={providerFieldIndex}
          total={providerFields.length}
          value={fieldDraft}
          onChange={setFieldDraft}
          onSubmit={submitProviderField}
        />
      ) : null}

      {step === "pick-search" ? (
        <Box flexDirection="column">
          <Text color={theme.muted}>
            Inference: {ONBOARDING_PROVIDER_LABELS[provider]}
          </Text>
          <Box marginTop={1}>
            <SelectInput
              items={searchItems}
              itemComponent={SelectMenuItem}
              onSelect={(item) => beginSearch(item.value)}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>
              enter: select | esc: back | ctrl+c: exit
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.muted}>
              Advanced settings are available later via `hooman config`.
            </Text>
          </Box>
        </Box>
      ) : null}

      {step === "search-fields" ? (
        <FieldPrompt
          providerLabel={ONBOARDING_SEARCH_LABELS[searchProvider]}
          field={searchFields[searchFieldIndex]!}
          index={searchFieldIndex}
          total={searchFields.length}
          value={fieldDraft}
          onChange={setFieldDraft}
          onSubmit={submitSearchField}
        />
      ) : null}

      {step === "validating-provider" || step === "finishing" ? (
        <Text color={theme.muted}>Please wait…</Text>
      ) : null}
    </Box>
  );
}

function FieldPrompt(props: {
  providerLabel: string;
  field: OnboardingFieldDef;
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color={theme.muted}>
        {props.providerLabel} · step {props.index + 1} of {props.total}
      </Text>
      <Text bold>
        {props.field.label}
        {props.field.required ? <Text color={theme.error}> *</Text> : null}
      </Text>
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={theme.primary}
        paddingX={1}
      >
        <Text color={theme.muted}>{"> "}</Text>
        <TextInput
          value={props.value}
          onChange={props.onChange}
          onSubmit={props.onSubmit}
          placeholder={props.field.placeholder ?? ""}
          mask={props.field.sensitive ? "*" : undefined}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>
          enter: continue | esc: back | ctrl+c: exit
        </Text>
      </Box>
    </Box>
  );
}
