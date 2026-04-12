export function logAgentEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    })
  );
}

export function createRequestTimer() {
  const start = Date.now();
  return {
    elapsedMs() {
      return Date.now() - start;
    },
  };
}
