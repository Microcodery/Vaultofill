import { describe, it, expect } from "vitest";
import {
  deriveKey,
  encrypt,
  decrypt,
  isEncrypted,
  decodeEnvelope,
  randomSalt,
  exportDerivedKey,
  importDerivedKey,
  clampIterations,
  PBKDF2_ITERATIONS,
} from "../../../src/core/crypto/vaultCipher";

// A low iteration count keeps derivation fast in tests; the cipher path is
// identical regardless of iter (it's stamped into the envelope and re-used).
const FAST_ITER = 1_000;

const derive = (password: string, salt = randomSalt()) => deriveKey(password, salt, FAST_ITER);

const PLAINTEXT = JSON.stringify([{ canonicalLabel: "EMAIL", value: "ada@example.com" }]);

describe("vaultCipher", () => {
  it("round-trips plaintext through encrypt/decrypt with the same password", async () => {
    const salt = randomSalt();
    const key = await derive("correct horse", salt);
    const envelope = await encrypt(PLAINTEXT, key);

    // Re-derive from the envelope's salt/iter, as a real load would.
    const meta = decodeEnvelope(envelope)!;
    const key2 = await deriveKey("correct horse", meta.salt, meta.iter);
    expect(await decrypt(envelope, key2.key)).toBe(PLAINTEXT);
  });

  it("produces a fresh IV per encryption (ciphertext differs) but both decrypt", async () => {
    const key = await derive("pw");
    const a = await encrypt(PLAINTEXT, key);
    const b = await encrypt(PLAINTEXT, key);
    expect(decodeEnvelope(a)!.iv).not.toEqual(decodeEnvelope(b)!.iv);
    expect(await decrypt(a, key.key)).toBe(PLAINTEXT);
    expect(await decrypt(b, key.key)).toBe(PLAINTEXT);
  });

  it("a wrong password cannot decrypt (GCM rejects)", async () => {
    const salt = randomSalt();
    const key = await derive("right", salt);
    const envelope = await encrypt(PLAINTEXT, key);
    const wrong = await deriveKey("wrong", salt, FAST_ITER);
    await expect(decrypt(envelope, wrong.key)).rejects.toThrow();
  });

  it("a tampered ciphertext byte makes decrypt reject", async () => {
    const key = await derive("pw");
    const envelope = await encrypt(PLAINTEXT, key);
    const parsed = JSON.parse(envelope);
    // Flip a byte in the base64 ciphertext (swap the first char for a different one).
    parsed.ct = (parsed.ct[0] === "A" ? "B" : "A") + parsed.ct.slice(1);
    await expect(decrypt(JSON.stringify(parsed), key.key)).rejects.toThrow();
  });

  it("detects an encrypted envelope vs a plaintext vault", async () => {
    const key = await derive("pw");
    const envelope = await encrypt(PLAINTEXT, key);
    expect(isEncrypted(envelope)).toBe(true);
    expect(isEncrypted(PLAINTEXT)).toBe(false); // a JSON array is a plaintext vault
    expect(isEncrypted("[]")).toBe(false);
    expect(isEncrypted("not json")).toBe(false);
    expect(isEncrypted('{"v":2,"alg":"AES-GCM"}')).toBe(false); // wrong version → not ours
  });

  it("decrypt throws on a non-envelope input", async () => {
    const key = await derive("pw");
    await expect(decrypt(PLAINTEXT, key.key)).rejects.toThrow();
  });

  it("stamps the salt/iter into the envelope so a fresh derive can decrypt", async () => {
    const key = await derive("pw");
    const envelope = await encrypt(PLAINTEXT, key);
    const meta = decodeEnvelope(envelope)!;
    expect(meta.iter).toBe(FAST_ITER);
    expect(meta.salt).toEqual(key.salt);
    expect(meta.iv.length).toBe(12);
  });

  it("defaults to 600k PBKDF2 iterations", async () => {
    const key = await deriveKey("pw", randomSalt());
    expect(key.iter).toBe(PBKDF2_ITERATIONS);
  });

  it("export/import a derived key round-trips (session-cache path)", async () => {
    const salt = randomSalt();
    const key = await derive("pw", salt);
    const envelope = await encrypt(PLAINTEXT, key);

    const bytes = await exportDerivedKey(key);
    const restored = await importDerivedKey(bytes);
    expect(restored.salt).toEqual(key.salt);
    expect(restored.iter).toBe(FAST_ITER);
    expect(await decrypt(envelope, restored.key)).toBe(PLAINTEXT);
  });

  it("clampIterations bounds a corrupt/hostile count to a safe finite range", () => {
    expect(clampIterations(0)).toBe(1);
    expect(clampIterations(-5)).toBe(1);
    expect(clampIterations(Number.POSITIVE_INFINITY)).toBe(PBKDF2_ITERATIONS);
    expect(clampIterations(Number.NaN)).toBe(PBKDF2_ITERATIONS);
    expect(clampIterations(600_000)).toBe(600_000); // legit value untouched
    expect(clampIterations(1e12)).toBeLessThanOrEqual(10_000_000); // capped
  });

  it("still recognizes an envelope with a corrupt iter (clamped, not rejected)", async () => {
    const key = await derive("pw", randomSalt());
    const envelope = JSON.parse(await encrypt(PLAINTEXT, key)) as Record<string, unknown>;
    envelope.iter = 0; // corrupt
    const raw = JSON.stringify(envelope);
    expect(isEncrypted(raw)).toBe(true); // must NOT fall through to the plaintext loader
    expect(decodeEnvelope(raw)!.iter).toBe(1); // clamped
  });
});
