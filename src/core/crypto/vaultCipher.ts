/**
 * Pure at-rest cipher for the serialized vault string. WebCrypto only — no deps,
 * no home-rolled crypto. Core module: NO ext imports (runs unchanged in the
 * extension and under plain Node/vitest, both of which expose globalThis.crypto).
 *
 * Design (do not weaken):
 *  - Key derivation: PBKDF2-HMAC-SHA-256, 600k iterations, random 16-byte salt →
 *    a 256-bit AES-GCM key.
 *  - Cipher: AES-GCM-256 with a fresh random 12-byte IV per encryption. GCM's auth
 *    tag authenticates the ciphertext, so a wrong key or a tampered blob makes
 *    decrypt() reject — callers treat that as "wrong password / cannot decrypt".
 *  - Envelope: a versioned JSON wrapper the storage layer can distinguish from a
 *    plaintext vault (a JSON array). The salt/iv live in the envelope, never in
 *    config; the password/key are never persisted here.
 *
 * Threat model: this protects the at-rest blob given a password. It does NOT
 * protect a compromised browser/extension at runtime — the decrypted vault and
 * the derived key are in memory while the vault is in use. Keys are derived
 * `extractable` so "session" unlock can cache the key bytes across panel reopens;
 * that is an in-memory/session-storage exposure we accept for that mode.
 */

export const PBKDF2_ITERATIONS = 600_000;
// Upper bound on the iteration count we'll honor from a stored envelope. The field
// is attacker-/corruption-controllable, and PBKDF2 with a huge count hangs the
// unlock (a zero/negative count throws) — so clamp it. We only ever WRITE 600k, so
// this ceiling never affects a legit blob; a tampered count just fails to decrypt
// (treated as a wrong password), never a hang or crash.
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const ENVELOPE_VERSION = 1;
const ALG = "AES-GCM";
const KDF = "PBKDF2-SHA256";

/** A derived AES-GCM key bundled with the salt/iter it came from, so encrypt()
 *  can stamp them into the envelope for a future load to re-derive. */
export interface DerivedKey {
  key: CryptoKey;
  salt: Uint8Array;
  iter: number;
}

/** The exportable, non-secret-metadata + raw-key-bytes form used to cache a
 *  "session" unlock key (base64). Storing the raw key bytes is the accepted
 *  tradeoff for session mode — see the module threat-model note. */
export interface DerivedKeyBytes {
  key: string;
  salt: string;
  iter: number;
}

interface Envelope {
  v: number;
  alg: string;
  kdf: string;
  iter: number;
  salt: Uint8Array;
  iv: Uint8Array;
  ct: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/** A fresh random 16-byte PBKDF2 salt. A vault keeps one stable salt across
 *  re-saves (only the IV is fresh per encryption), established when encryption
 *  is first enabled. */
export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Derive a 256-bit AES-GCM key from the password + salt via PBKDF2-SHA-256.
 *  Extractable so "session" unlock can export/cache the key bytes. */
export async function deriveKey(password: string, salt: Uint8Array, iter: number = PBKDF2_ITERATIONS): Promise<DerivedKey> {
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" },
    baseKey,
    { name: ALG, length: 256 },
    true, // extractable — required to cache the key for "session" unlock
    ["encrypt", "decrypt"],
  );
  return { key, salt, iter };
}

/** Encrypt a plaintext (the serialized vault) into a versioned envelope string.
 *  Uses the key's stable salt/iter and a fresh random IV per call. */
export async function encrypt(plaintext: string, key: DerivedKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: ALG, iv: iv as BufferSource }, key.key, enc.encode(plaintext));
  const envelope: Record<string, unknown> = {
    v: ENVELOPE_VERSION,
    alg: ALG,
    kdf: KDF,
    iter: key.iter,
    salt: toB64(key.salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
  return JSON.stringify(envelope);
}

/** Decrypt an envelope string with a derived key. Rejects on a wrong key or a
 *  tampered blob (GCM auth-tag failure) — callers treat any rejection as
 *  "wrong password / cannot decrypt". Throws on a non-envelope input. */
export async function decrypt(envelope: string, key: CryptoKey): Promise<string> {
  const parsed = decodeEnvelope(envelope);
  if (!parsed) throw new Error("not an encrypted vault envelope");
  const pt = await crypto.subtle.decrypt({ name: ALG, iv: parsed.iv as BufferSource }, key, parsed.ct as BufferSource);
  return dec.decode(pt);
}

/** Parse a raw stored blob as our envelope, or return null if it isn't one (a
 *  plaintext vault is a JSON array, so it decodes to null). Never throws. */
export function decodeEnvelope(raw: string): Envelope | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.v !== ENVELOPE_VERSION || o.alg !== ALG || typeof o.kdf !== "string" || !o.kdf.startsWith("PBKDF2")) return null;
  if (typeof o.salt !== "string" || typeof o.iv !== "string" || typeof o.ct !== "string") return null;
  try {
    // Clamp iter (don't reject on a bad one) so an envelope-shaped blob is still
    // recognized as encrypted — returning null here would route it to the plaintext
    // loader and risk clobbering a recoverable vault.
    const iter = clampIterations(typeof o.iter === "number" ? o.iter : PBKDF2_ITERATIONS);
    return { v: o.v, alg: o.alg, kdf: o.kdf, iter, salt: fromB64(o.salt), iv: fromB64(o.iv), ct: fromB64(o.ct) };
  } catch {
    return null; // malformed base64 → not a usable envelope
  }
}

/** Bound an envelope's iteration count to a safe, finite range. */
export function clampIterations(iter: number): number {
  if (!Number.isFinite(iter)) return PBKDF2_ITERATIONS;
  return Math.min(Math.max(1, Math.floor(iter)), MAX_ITERATIONS);
}

/** Whether a raw stored blob is an encrypted envelope (vs a plaintext vault). */
export function isEncrypted(raw: string): boolean {
  return decodeEnvelope(raw) !== null;
}

/** Export a derived key to cacheable bytes (base64) for "session" unlock. */
export async function exportDerivedKey(key: DerivedKey): Promise<DerivedKeyBytes> {
  const raw = await crypto.subtle.exportKey("raw", key.key);
  return { key: toB64(new Uint8Array(raw)), salt: toB64(key.salt), iter: key.iter };
}

/** Reconstruct a derived key from cached bytes. */
export async function importDerivedKey(bytes: DerivedKeyBytes): Promise<DerivedKey> {
  const key = await crypto.subtle.importKey("raw", fromB64(bytes.key) as BufferSource, { name: ALG, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  return { key, salt: fromB64(bytes.salt), iter: bytes.iter };
}
