export function parseCookies(header) {
    if (!header) {
        return {};
    }
    return header
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
        const idx = part.indexOf("=");
        if (idx < 0) {
            return acc;
        }
        const key = decodeURIComponent(part.slice(0, idx).trim());
        const value = decodeURIComponent(part.slice(idx + 1).trim());
        acc[key] = value;
        return acc;
    }, {});
}
export function serializeCookie(name, value, options = {}) {
    const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
    parts.push(`Path=${options.path || "/"}`);
    if (typeof options.maxAgeSeconds === "number") {
        parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
    }
    if (options.domain) {
        parts.push(`Domain=${options.domain}`);
    }
    if (options.httpOnly !== false) {
        parts.push("HttpOnly");
    }
    if (options.secure) {
        parts.push("Secure");
    }
    parts.push(`SameSite=${options.sameSite || "Lax"}`);
    return parts.join("; ");
}
