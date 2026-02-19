export type LogValue = unknown;

function emit(level: "info" | "warn" | "error", event: string, fields: Record<string, LogValue>): void {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields
  };

  const serialized = JSON.stringify(payload);

  if (level === "error") {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export function logInfo(event: string, fields: Record<string, LogValue> = {}): void {
  emit("info", event, fields);
}

export function logWarn(event: string, fields: Record<string, LogValue> = {}): void {
  emit("warn", event, fields);
}

export function logError(event: string, fields: Record<string, LogValue> = {}): void {
  emit("error", event, fields);
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}
