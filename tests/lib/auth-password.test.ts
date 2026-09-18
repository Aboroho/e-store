import { describe, expect, it } from "vitest";
import { evaluatePasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateApiKey, generateToken, hashToken, signPayload, verifyPayloadSignature, encryptSecret, decryptSecret } from "@/lib/crypto";

describe("password policy", () => {
  it("rejects short passwords", () => {
    const result = evaluatePasswordPolicy("Ab1!xyz");
    expect(result.valid).toBe(false);
    expect(result.problems.join(" ")).toMatch(/at least/i);
  });

  it("rejects single character classes", () => {
    expect(evaluatePasswordPolicy("aaaaaaaaaaaaaaaa").valid).toBe(false);
    expect(evaluatePasswordPolicy("1234567890123").valid).toBe(false);
  });

  it("accepts a strong password with three character classes", () => {
    expect(evaluatePasswordPolicy("Warehouse-2026!").valid).toBe(true);
  });

  it("rejects passwords containing the email local part or the user's name", () => {
    const withEmail = evaluatePasswordPolicy("Rahman-Khan-99!", { email: "rahman.khan@example.com" });
    expect(withEmail.valid).toBe(false);
    const withName = evaluatePasswordPolicy("Sultana#2026", { name: "Sultana Rahman" });
    expect(withName.valid).toBe(false);
  });

  it("flags common passwords", () => {
    expect(evaluatePasswordPolicy("Password-123").valid).toBe(false);
    expect(evaluatePasswordPolicy("Welcome!2026").valid).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies a bcrypt hash without storing the plain text", async () => {
    const hash = await hashPassword("Warehouse-2026!");
    expect(hash).not.toContain("Warehouse-2026!");
    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword("Warehouse-2026!", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("crypto helpers", () => {
  it("hashes tokens deterministically and compares safely", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).toHaveLength(64);
  });

  it("generates unpredictable tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
    expect(generateToken(16).length).toBeGreaterThan(10);
  });

  it("signs and verifies webhook payloads", () => {
    const payload = JSON.stringify({ order: "ORD-00001", status: "DELIVERED" });
    const signature = signPayload(payload, "webhook-secret");
    expect(verifyPayloadSignature(payload, "webhook-secret", signature)).toBe(true);
    expect(verifyPayloadSignature(payload, "other-secret", signature)).toBe(false);
    expect(verifyPayloadSignature(`${payload} `, "webhook-secret", signature)).toBe(false);
  });

  it("encrypts integration secrets with AES-256-GCM", () => {
    const encrypted = encryptSecret("steadfast-api-key");
    expect(JSON.stringify(encrypted)).not.toContain("steadfast-api-key");
    expect(decryptSecret(encrypted)).toBe("steadfast-api-key");

    // A tampered ciphertext must fail authentication instead of returning garbage.
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from("not the real ciphertext").toString("base64"),
    };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("generates API keys with a searchable prefix and a secret that is only shown once", () => {
    const key = generateApiKey();
    expect(key.prefix).toMatch(/^esk_[A-Za-z0-9]{8}$/);
    expect(key.plaintext.startsWith(`${key.prefix}.`)).toBe(true);
    expect(key.hash).toBe(hashToken(key.plaintext));
  });
});
