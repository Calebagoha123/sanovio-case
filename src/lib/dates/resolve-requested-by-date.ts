import {
  addDays,
  addWeeks,
  format,
  isBefore,
  isValid,
  nextDay,
  parse,
  parseISO,
  setYear,
  startOfDay,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";

// Default hospital timezone — override via HOSPITAL_TIMEZONE env var
const DEFAULT_TIMEZONE = process.env.HOSPITAL_TIMEZONE ?? "Europe/Zurich";

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseCountToken(token: string): number | null {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  return NUMBER_WORDS[token] ?? null;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timezone?: string): string {
  if (timezone && isValidTimezone(timezone)) {
    return timezone;
  }
  return DEFAULT_TIMEZONE;
}

function nowInZone(timezone?: string): Date {
  return toZonedTime(new Date(), resolveTimezone(timezone));
}

function assertFutureDate(parsed: Date, timezone: string, originalInput: string): string {
  const today = startOfDay(nowInZone(timezone));
  const parsedDay = startOfDay(toZonedTime(parsed, timezone));
  if (isBefore(parsedDay, today)) {
    throw new Error(
      `Date "${originalInput}" is in the past. Please provide a future delivery date.`
    );
  }
  return format(parsedDay, "yyyy-MM-dd");
}

function tryParseNaturalMonthDate(input: string, timezone: string): string | null {
  const normalized = input
    .trim()
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ");

  const now = nowInZone(timezone);
  const currentYear = Number(format(now, "yyyy"));
  const formats = [
    "d MMMM yyyy",
    "d MMM yyyy",
    "MMMM d yyyy",
    "MMM d yyyy",
    "d MMMM",
    "d MMM",
    "MMMM d",
    "MMM d",
  ];

  for (const candidateFormat of formats) {
    const hasExplicitYear = candidateFormat.includes("yyyy");
    const candidateInput = hasExplicitYear ? normalized : `${normalized} ${currentYear}`;
    const parseFormat = hasExplicitYear ? candidateFormat : `${candidateFormat} yyyy`;
    const parsed = parse(candidateInput, parseFormat, now);

    if (!isValid(parsed)) {
      continue;
    }

    if (hasExplicitYear) {
      return assertFutureDate(parsed, timezone, input);
    }

    const parsedThisYear = setYear(parsed, currentYear);
    if (!isBefore(startOfDay(parsedThisYear), startOfDay(now))) {
      return format(parsedThisYear, "yyyy-MM-dd");
    }

    const parsedNextYear = setYear(parsed, currentYear + 1);
    return format(parsedNextYear, "yyyy-MM-dd");
  }

  return null;
}

export function getHospitalTimezone(timezone?: string): string {
  return resolveTimezone(timezone);
}

export function getCurrentHospitalDate(timezone?: string): string {
  return format(nowInZone(timezone), "yyyy-MM-dd");
}

/**
 * Resolve a date phrase to a YYYY-MM-DD string in the hospital timezone.
 *
 * Accepted inputs:
 *  - "today"
 *  - "tomorrow"
 *  - weekday names like "Monday", "next Friday"
 *  - ISO dates "YYYY-MM-DD"
 *  - natural month/day phrases like "10 May", "10th May", "May 10"
 *
 * Throws for unparseable input or dates in the past.
 */
export function resolveRequestedByDate(input: string, timezone?: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Date phrase is empty — please provide a delivery date.");
  }

  const activeTimezone = resolveTimezone(timezone);
  const lowerFull = trimmed.toLowerCase().replace(/\s+/g, " ").trim();
  const lower = lowerFull.replace(/^next\s+/, "");

  // "today"
  if (lower === "today") {
    return getCurrentHospitalDate(activeTimezone);
  }

  // "tomorrow"
  if (lower === "tomorrow") {
    const tomorrow = addDays(nowInZone(activeTimezone), 1);
    return format(tomorrow, "yyyy-MM-dd");
  }

  // relative windows like "in two weeks", "next 2 weeks", "in 10 days"
  const relativeMatch = lowerFull.match(/^(?:in|within|next)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|days|week|weeks)$/);
  if (relativeMatch) {
    const count = parseCountToken(relativeMatch[1]);
    const unit = relativeMatch[2];
    if (count && count > 0) {
      const now = nowInZone(activeTimezone);
      const resolved =
        unit.startsWith("week") ? addWeeks(now, count) : addDays(now, count);
      return format(resolved, "yyyy-MM-dd");
    }
  }

  if (lowerFull === "next two weeks" || lowerFull === "within two weeks") {
    return format(addWeeks(nowInZone(activeTimezone), 2), "yyyy-MM-dd");
  }

  if (lowerFull === "next week") {
    return format(addWeeks(nowInZone(activeTimezone), 1), "yyyy-MM-dd");
  }

  // weekday name
  if (lower in DAY_NAMES) {
    const targetDay = DAY_NAMES[lower] as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const now = nowInZone(activeTimezone);
    const next = nextDay(now, targetDay);
    return format(next, "yyyy-MM-dd");
  }

  // ISO date YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parseISO(trimmed);
    if (!isValid(parsed)) {
      throw new Error(`Invalid date: "${trimmed}"`);
    }
    return assertFutureDate(parsed, activeTimezone, trimmed);
  }

  const naturalDate = tryParseNaturalMonthDate(trimmed, activeTimezone);
  if (naturalDate) {
    return naturalDate;
  }

  throw new Error(
    `Cannot parse date phrase: "${input}". ` +
      `Use "today", "tomorrow", a weekday name, a date like "10 May", or YYYY-MM-DD format.`
  );
}
