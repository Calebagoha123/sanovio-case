export const SESSION_STORAGE_KEY = "sanovio-session-id";

export function getOrCreateSessionId(
  storage: Pick<Storage, "getItem" | "setItem">,
  generate: () => string = () => crypto.randomUUID()
): string {
  const existing = storage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = generate();
  storage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}
