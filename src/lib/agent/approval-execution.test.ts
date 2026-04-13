import { describe, expect, it, beforeEach } from "vitest";
import {
  APPROVAL_TTL_MS,
  createApprovalExpiry,
  executeApprovalOnce,
  isPendingApprovalExpired,
  resetApprovalExecutionRegistry,
} from "./approval-execution";

describe("approval execution", () => {
  beforeEach(() => {
    resetApprovalExecutionRegistry();
  });

  it("marks a pending approval as expired once its expiry time passes", () => {
    const now = Date.UTC(2026, 3, 13, 12, 0, 0);
    const expiry = createApprovalExpiry(now);

    expect(isPendingApprovalExpired({ expiresAt: expiry.expiresAt }, now + APPROVAL_TTL_MS - 1)).toBe(false);
    expect(isPendingApprovalExpired({ expiresAt: expiry.expiresAt }, now + APPROVAL_TTL_MS)).toBe(true);
  });

  it("treats malformed expiry timestamps as expired", () => {
    expect(isPendingApprovalExpired({ expiresAt: "not-a-date" })).toBe(true);
  });

  it("joins concurrent submissions for the same tool call and only executes once", async () => {
    let callCount = 0;

    const executor = async () => {
      callCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        text: "created",
        artifacts: [],
        toolCallsMade: ["createReorderRequest"],
      };
    };

    const [first, second] = await Promise.all([
      executeApprovalOnce("tool-1", executor),
      executeApprovalOnce("tool-1", executor),
    ]);

    expect(callCount).toBe(1);
    expect(first.text).toBe("created");
    expect(second.text).toBe("created");
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
  });

  it("reuses the completed result for duplicate approval submissions", async () => {
    let callCount = 0;

    const executor = async () => {
      callCount += 1;
      return {
        text: "created",
        artifacts: [],
        toolCallsMade: ["createReorderRequest"],
      };
    };

    const first = await executeApprovalOnce("tool-2", executor);
    const second = await executeApprovalOnce("tool-2", executor);

    expect(callCount).toBe(1);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.text).toBe("created");
  });
});
