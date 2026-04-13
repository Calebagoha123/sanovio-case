import { describe, expect, it } from "vitest";
import { formatUserFacingError } from "./user-facing-errors";

describe("formatUserFacingError", () => {
  it("maps expired approvals to a resubmission prompt", () => {
    expect(formatUserFacingError("Pending approval expired at 2026-04-13T12:10:00.000Z", "2026-04-13"))
      .toContain("confirmation expired");
  });
});
