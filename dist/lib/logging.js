function emit(level, event, fields) {
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
export function logInfo(event, fields = {}) {
    emit("info", event, fields);
}
export function logWarn(event, fields = {}) {
    emit("warn", event, fields);
}
export function logError(event, fields = {}) {
    emit("error", event, fields);
}
export function serializeError(error) {
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
