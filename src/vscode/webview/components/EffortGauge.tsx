import { For } from "solid-js";

/** 4-bar gauge glyph indicating reasoning-effort level (0-4 filled bars), matching the composer pill's accent color. */
export default function EffortGauge(props: { bars: number; class?: string }) {
  const heights = [4, 6, 8, 10];
  return (
    <span class={`flex items-end gap-[1.5px] ${props.class ?? ""}`}>
      <For each={heights}>
        {(h, i) => (
          <span
            class="w-[2.5px] rounded-[1px]"
            classList={{
              "bg-current": i() < props.bars,
              "bg-current/25": i() >= props.bars,
            }}
            style={{ height: `${h}px` }}
          />
        )}
      </For>
    </span>
  );
}
