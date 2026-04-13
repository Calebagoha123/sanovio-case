import { describe, expect, it, vi } from "vitest";
import { getOrCreateSessionId, SESSION_STORAGE_KEY } from "./session-id";

describe("getOrCreateSessionId", () => {
  it("returns an existing stored session id without generating a new one", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("existing-session"),
      setItem: vi.fn(),
    };
    const generate = vi.fn().mockReturnValue("new-session");

    const result = getOrCreateSessionId(storage, generate);

    expect(result).toBe("existing-session");
    expect(generate).not.toHaveBeenCalled();
    expect(storage.getItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("generates and persists a session id when none exists", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };
    const generate = vi.fn().mockReturnValue("generated-session");

    const result = getOrCreateSessionId(storage, generate);

    expect(result).toBe("generated-session");
    expect(storage.setItem).toHaveBeenCalledWith(
      SESSION_STORAGE_KEY,
      "generated-session"
    );
  });
});
