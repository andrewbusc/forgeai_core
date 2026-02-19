import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCb);
const MIN_PASSWORD_LENGTH = 8;
export async function hashPassword(password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    const salt = randomBytes(16).toString("hex");
    const derived = (await scrypt(password, salt, 64));
    return `${salt}:${derived.toString("hex")}`;
}
export async function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(":");
    if (!salt || !hash) {
        return false;
    }
    const derived = (await scrypt(password, salt, 64));
    const hashBuffer = Buffer.from(hash, "hex");
    if (derived.length !== hashBuffer.length) {
        return false;
    }
    return timingSafeEqual(derived, hashBuffer);
}
