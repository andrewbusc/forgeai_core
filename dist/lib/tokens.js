import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
const tokenSecret = process.env.AUTH_TOKEN_SECRET;
if (!tokenSecret) {
    throw new Error("AUTH_TOKEN_SECRET is required.");
}
const resolvedTokenSecret = tokenSecret;
const accessTokenTtlMinutes = Number(process.env.ACCESS_TOKEN_TTL_MINUTES || 15);
const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
function base64UrlEncode(value) {
    return Buffer.from(value, "utf8").toString("base64url");
}
function base64UrlDecode(value) {
    return Buffer.from(value, "base64url").toString("utf8");
}
function signData(data) {
    return createHmac("sha256", resolvedTokenSecret).update(data).digest("base64url");
}
function createToken(type, sid, uid, expiresInSeconds) {
    const payload = {
        type,
        sid,
        uid,
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        jti: randomBytes(12).toString("hex")
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signData(encodedPayload);
    return `${encodedPayload}.${signature}`;
}
export function createAccessToken(sid, uid) {
    const expiresInSeconds = accessTokenTtlMinutes * 60;
    const token = createToken("access", sid, uid, expiresInSeconds);
    return {
        token,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    };
}
export function createRefreshToken(sid, uid) {
    const expiresInSeconds = refreshTokenTtlDays * 24 * 60 * 60;
    const token = createToken("refresh", sid, uid, expiresInSeconds);
    return {
        token,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    };
}
export function verifyToken(token, expectedType) {
    const parts = token.split(".");
    if (parts.length !== 2) {
        throw new Error("Malformed token.");
    }
    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = signData(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
        throw new Error("Invalid token signature.");
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.type !== expectedType) {
        throw new Error("Invalid token type.");
    }
    if (!payload.sid || !payload.uid || typeof payload.exp !== "number") {
        throw new Error("Invalid token payload.");
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new Error("Token expired.");
    }
    return payload;
}
export function hashRefreshToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
export function getAccessTokenMaxAgeSeconds() {
    return accessTokenTtlMinutes * 60;
}
export function getRefreshTokenMaxAgeSeconds() {
    return refreshTokenTtlDays * 24 * 60 * 60;
}
