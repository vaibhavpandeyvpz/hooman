import { render } from "ink";
import { OnboardingApp } from "./app.js";

/**
 * Run the first-run Ink onboarding flow. Resolves `true` when config was
 * written successfully, `false` if the user cancelled.
 */
export async function onboard(): Promise<boolean> {
  let completed = false;
  let done = false;
  const { waitUntilExit, unmount } = render(
    <OnboardingApp
      onComplete={() => {
        completed = true;
        done = true;
      }}
      onCancel={() => {
        done = true;
      }}
    />,
    { exitOnCtrlC: false },
  );

  try {
    await waitUntilExit();
  } finally {
    if (!done) {
      unmount();
    }
  }
  return completed;
}
