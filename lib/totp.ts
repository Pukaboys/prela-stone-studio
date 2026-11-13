/**
 * Two-step login codes (TOTP, RFC 6238): the 6-digit codes from Google
 * Authenticator, Microsoft Authenticator, 1Password and similar apps.
 * 30-second steps, SHA-1, one step of clock drift allowed either way, and a
 * code can be used only once (replay protection by step counter).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid key.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** The 6-digit code for one 30-second step. */
export function hotp(secret: string, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", Buffer.from(base32Decode(secret))).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const STEP_SECONDS = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * The step a code belongs to (now ± 1 step), or null when it is wrong or was
 * already used (step not after `lastStep`).
 */
export function checkTotp(secret: string, code: string, lastStep = -1, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const step = stepAt(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

/** A new random key (160 bits, as authenticator apps expect). */
export const newSecret = () => base32Encode(randomBytes(20));

/** Link the authenticator apps understand (shown as a QR code). */
export const otpauthUri = (email: string, secret: string) =>
  `otpauth://totp/${encodeURIComponent("Jeo Stone Studio:" + email)}?secret=${secret}&issuer=${encodeURIComponent("Jeo Stone Studio")}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

// ---------------------------------------------------------------- recovery codes
const hashCode = (c: string) => createHash("sha256").update(c.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");

/** Ten one-time recovery codes ("abcd-efgh") and their hashes for storage. */
export function newRecoveryCodes() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const codes = Array.from({ length: 10 }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => chars[x % chars.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}

/** Index of the matching stored recovery-code hash, or -1. */
export const findRecoveryCode = (hashes: string[], code: string) => hashes.indexOf(hashCode(code));
