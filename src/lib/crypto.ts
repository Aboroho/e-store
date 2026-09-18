import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Cryptography helpers.
 *
 * - Session tokens and verification codes are stored as SHA-256 hashes.
 * - Third-party credentials (courier, payment, marketing, storage) are
 *   encrypted at rest with AES-256-GCM using a key derived from
 *   APP_ENCRYPTION_KEY.
 */

const TOKEN_BYTES = 32;

/** Generate a cryptographically secure random token (URL safe, no padding). */
export function generateToken(bytes = TOKEN_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/** Generate a numeric one-time code of the given length (for SMS/email). */
export function generateNumericCode(length = 6): string {
  const digits = "0123456789";
  let code = "";
  const random = randomBytes(length);
  for (let index = 0; index < length; index += 1) {
    const byte = random[index] ?? 0;
    code += digits[byte % 10];
  }
  return code;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash a token for at-rest storage. */
export function hashToken(token: string): string {
  return sha256(token);
}

/** Constant time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function encryptionKey(): Buffer {
  // Derive a stable 32 byte key from the configured secret.
  return createHash("sha256").update(env().APP_ENCRYPTION_KEY).digest();
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/** Encrypt a secret with AES-256-GCM. */
export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypt a secret previously produced by `encryptSecret`. */
export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Mask a secret for display, keeping only the tail. */
export function maskSecret(secret: string, visible = 4): string {
  if (secret.length <= visible) return "*".repeat(secret.length);
  return `${"*".repeat(Math.max(4, secret.length - visible))}${secret.slice(-visible)}`;
}

/** HMAC signature used for outgoing webhooks (hex encoded). */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Verify an outgoing webhook signature in constant time. */
export function verifyPayloadSignature(payload: string, secret: string, signature: string): boolean {
  const expected = signPayload(payload, secret);
  return safeEqual(expected, signature.replace(/^sha256=/, ""));
}

/**
 * Build an API key: the plaintext is shown once, only the prefix and the
 * SHA-256 hash are stored.
 */
export function generateApiKey(): { plaintext: string; prefix: string; hash: string; lastFour: string } {
  const random = generateToken(24).replace(/[-_]/g, "");
  const prefix = `esk_${random.slice(0, 8)}`;
  const secretPart = random.slice(8);
  const plaintext = `${prefix}.${secretPart}`;
  return { plaintext, prefix, hash: sha256(plaintext), lastFour: plaintext.slice(-4) };
}

/** Hash an API key presented by a client so it can be looked up safely. */
export function hashApiKey(plaintext: string): string {
  return sha256(plaintext);
}

/** Extract the public prefix of an API key (`prefix.secret`). */
export function apiKeyPrefix(plaintext: string): string | null {
  const separatorIndex = plaintext.indexOf(".");
  if (separatorIndex <= 0) return null;
  return plaintext.slice(0, separatorIndex);
}
