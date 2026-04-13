import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

type TimeInfo = {
  timezone: string;
  datetime: string;
  day_of_week: string;
  is_dst: boolean;
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function getLocalTimezone(): string {
  const zone = DateTime.local().zoneName;
  return IANAZone.isValidZone(zone) ? zone : "UTC";
}

function resolveTimezone(timezone?: string): string {
  const zone = timezone?.trim() || getLocalTimezone();
  if (!IANAZone.isValidZone(zone)) {
    throw new Error(`Invalid timezone: ${zone}`);
  }
  return zone;
}

function toTimeInfo(dt: DateTime): TimeInfo {
  return {
    timezone: dt.zoneName ?? "UTC",
    datetime: dt.toISO({ suppressMilliseconds: true }) ?? dt.toISO() ?? "",
    day_of_week: dt.weekdayLong ?? "",
    is_dst: dt.isInDST,
  };
}

function parseSourceTime(sourceTimezone: string, time: string): DateTime {
  const sourceNow = DateTime.now().setZone(sourceTimezone);
  const parsed = DateTime.fromFormat(time.trim(), "HH:mm", {
    zone: sourceTimezone,
  });

  if (!parsed.isValid) {
    throw new Error("Invalid time format. Expected HH:MM [24-hour format]");
  }

  return sourceNow.set({
    hour: parsed.hour,
    minute: parsed.minute,
    second: 0,
    millisecond: 0,
  });
}

function formatOffsetDifference(source: DateTime, target: DateTime): string {
  const diffHours = (target.offset - source.offset) / 60;
  const formatted = Number.isInteger(diffHours)
    ? diffHours.toFixed(1)
    : diffHours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${diffHours >= 0 ? "+" : ""}${formatted}h`;
}

export function createTimeTools() {
  const localTimezone = getLocalTimezone();

  return [
    tool({
      name: "get_current_time",
      description:
        "Get the current time in a specific timezone. Defaults to the local timezone when omitted.",
      inputSchema: z.object({
        timezone: z
          .string()
          .optional()
          .describe(
            `IANA timezone name (e.g. 'America/New_York', 'Europe/London'). Defaults to '${localTimezone}'.`,
          ),
      }),
      callback: async (input) => {
        const timezone = resolveTimezone(input.timezone);
        const current = DateTime.now().setZone(timezone);

        return toJsonValue(toTimeInfo(current));
      },
    }),
    tool({
      name: "convert_time",
      description:
        "Convert a time between timezones. Defaults omitted timezones to the local timezone.",
      inputSchema: z.object({
        source_timezone: z
          .string()
          .optional()
          .describe(
            `Source IANA timezone name. Defaults to '${localTimezone}'.`,
          ),
        time: z.string().describe("Time to convert in 24-hour format (HH:MM)."),
        target_timezone: z
          .string()
          .optional()
          .describe(
            `Target IANA timezone name. Defaults to '${localTimezone}'.`,
          ),
      }),
      callback: async (input) => {
        const sourceTimezone = resolveTimezone(input.source_timezone);
        const targetTimezone = resolveTimezone(input.target_timezone);
        const source = parseSourceTime(sourceTimezone, input.time);
        const target = source.setZone(targetTimezone);

        return toJsonValue({
          source: toTimeInfo(source),
          target: toTimeInfo(target),
          time_difference: formatOffsetDifference(source, target),
        });
      },
    }),
  ];
}
