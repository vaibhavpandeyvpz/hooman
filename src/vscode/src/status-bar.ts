import * as vscode from "vscode";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

/** Actions the status bar menu can trigger; implemented by the chat view / extension. */
export type StatusBarActions = {
  setConfigOption(
    configId: string,
    value: string | boolean,
    isBoolean: boolean,
  ): Promise<void>;
  newChat(): void;
  pickSession(): void;
  showOutput(): void;
  focusChat(): void;
  openConfig(): void;
};

type StatusState = {
  title: string;
  configOptions: SessionConfigOption[];
  busy: boolean;
};

/**
 * Status bar presence for Hooman: shows the live session state (model · mode,
 * spinner while a turn runs) and opens a quick-pick menu exposing every
 * session control — config option pickers, new chat, session list, output.
 */
export class HoomanStatusBar implements vscode.Disposable {
  static readonly menuCommand = "hooman.statusMenu";

  readonly #item: vscode.StatusBarItem;
  #state: StatusState = { title: "New chat", configOptions: [], busy: false };

  constructor(private readonly actions: StatusBarActions) {
    this.#item = vscode.window.createStatusBarItem(
      "hooman.status",
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.#item.name = "Hooman";
    this.#item.command = HoomanStatusBar.menuCommand;
    this.#render();
    this.#item.show();
  }

  update(state: Partial<StatusState>): void {
    this.#state = { ...this.#state, ...state };
    this.#render();
  }

  async showMenu(): Promise<void> {
    type MenuItem = vscode.QuickPickItem & {
      action?: () => void | Promise<void>;
    };
    const items: MenuItem[] = [];

    for (const option of this.#state.configOptions) {
      items.push({
        label: `$(settings) ${option.name}`,
        description: currentValueLabel(option),
        detail: option.description ?? undefined,
        action: () => this.#pickOptionValue(option),
      });
    }
    if (items.length > 0) {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    }
    items.push(
      {
        label: "$(comment-discussion) Focus chat",
        action: () => this.actions.focusChat(),
      },
      {
        label: "$(add) New chat",
        action: () => this.actions.newChat(),
      },
      {
        label: "$(history) Open session…",
        action: () => this.actions.pickSession(),
      },
      {
        label: "$(gear) Open settings…",
        action: () => this.actions.openConfig(),
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      {
        label: "$(output) Show output channel",
        action: () => this.actions.showOutput(),
      },
    );

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: this.#state.title
        ? `Hooman — ${this.#state.title}`
        : "Hooman",
    });
    if (picked?.action) {
      await picked.action();
    }
  }

  async #pickOptionValue(option: SessionConfigOption): Promise<void> {
    if (option.type === "boolean") {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "On", value: true, picked: option.currentValue === true },
          { label: "Off", value: false, picked: option.currentValue === false },
        ],
        { placeHolder: option.name },
      );
      if (picked) {
        await this.actions.setConfigOption(option.id, picked.value, true);
      }
      return;
    }
    const flat = flattenSelectOptions(option.options);
    const picked = await vscode.window.showQuickPick(
      flat.map((item) => ({
        label: item.name,
        description: item.value === option.currentValue ? "current" : undefined,
        detail: item.description ?? undefined,
        value: item.value,
      })),
      { placeHolder: option.name },
    );
    if (picked) {
      await this.actions.setConfigOption(option.id, picked.value, false);
    }
  }

  #render(): void {
    if (this.#state.busy) {
      this.#item.text = "$(sync~spin) Hooman";
    } else {
      const summary = this.#summary();
      this.#item.text = summary ? `$(hubot) ${summary}` : "$(hubot) Hooman";
    }
    const lines = [
      `Hooman — ${this.#state.title || "New chat"}`,
      ...this.#state.configOptions.map(
        (option) => `${option.name}: ${currentValueLabel(option)}`,
      ),
      "Click for session controls",
    ];
    this.#item.tooltip = lines.join("\n");
  }

  /** Short "Model · Mode" style summary for the item text. */
  #summary(): string {
    const parts: string[] = [];
    const model = this.#findOption("model");
    if (model) {
      parts.push(currentValueLabel(model));
    }
    const mode = this.#findOption("mode");
    if (mode) {
      parts.push(currentValueLabel(mode));
    }
    return parts.join(" · ");
  }

  #findOption(idOrCategory: string): SessionConfigOption | undefined {
    return this.#state.configOptions.find(
      (option) =>
        option.id === idOrCategory || option.category === idOrCategory,
    );
  }

  dispose(): void {
    this.#item.dispose();
  }
}

function currentValueLabel(option: SessionConfigOption): string {
  if (option.type === "boolean") {
    return option.currentValue ? "on" : "off";
  }
  const flat = flattenSelectOptions(option.options);
  return (
    flat.find((item) => item.value === option.currentValue)?.name ??
    String(option.currentValue)
  );
}

type FlatOption = { value: string; name: string; description?: string | null };

function flattenSelectOptions(
  options: Extract<SessionConfigOption, { type: "select" }>["options"],
): FlatOption[] {
  const flat: FlatOption[] = [];
  for (const entry of options ?? []) {
    if ("options" in entry && Array.isArray(entry.options)) {
      flat.push(...entry.options);
    } else {
      flat.push(entry as FlatOption);
    }
  }
  return flat;
}
