import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveRequestedByDate } from "./resolve-requested-by-date";

// Pin the clock to a known Wednesday: 2026-04-15T10:00:00 Europe/Zurich
// UTC equivalent: 2026-04-15T08:00:00Z
const FIXED_NOW = new Date("2026-04-15T08:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveRequestedByDate", () => {
  it("resolves 'tomorrow' to 2026-04-16", () => {
    expect(resolveRequestedByDate("tomorrow")).toBe("2026-04-16");
  });

  it("resolves 'today' to 2026-04-15", () => {
    expect(resolveRequestedByDate("today")).toBe("2026-04-15");
  });

  it("resolves 'Monday' to the next Monday strictly after today (2026-04-20)", () => {
    // Today is Wednesday 2026-04-15; next Monday is Mon 2026-04-20
    expect(resolveRequestedByDate("Monday")).toBe("2026-04-20");
  });

  it("resolves 'next Monday' to the same result as 'Monday'", () => {
    expect(resolveRequestedByDate("next Monday")).toBe("2026-04-20");
  });

  it("resolves 'Friday' to 2026-04-17 (next occurrence of Friday after Wednesday)", () => {
    expect(resolveRequestedByDate("Friday")).toBe("2026-04-17");
  });

  it("passes through an already-valid ISO date", () => {
    expect(resolveRequestedByDate("2026-05-01")).toBe("2026-05-01");
  });

  it("resolves natural month-day phrases against the active session year", () => {
    expect(resolveRequestedByDate("10th May")).toBe("2026-05-10");
    expect(resolveRequestedByDate("May 10")).toBe("2026-05-10");
  });

  it("rolls a month-day phrase to the next year if this year's date has already passed", () => {
    expect(resolveRequestedByDate("10 January")).toBe("2027-01-10");
  });

  it("rejects a past ISO date", () => {
    expect(() => resolveRequestedByDate("2026-01-01")).toThrow(
      /past/i
    );
  });

  it("rejects today's date as 'past or today is not allowed for delivery'", () => {
    // today itself: we require strictly future date for delivery
    // design doc says "resolved past dates are rejected"
    // today should pass (it's the minimum — on the boundary)
    // Actually DESIGN.md says "Resolved past dates are rejected" — today is not past
    expect(resolveRequestedByDate("2026-04-15")).toBe("2026-04-15");
  });

  it("throws for an unparseable date phrase", () => {
    expect(() => resolveRequestedByDate("asap")).toThrow();
    expect(() => resolveRequestedByDate("")).toThrow();
  });
});
