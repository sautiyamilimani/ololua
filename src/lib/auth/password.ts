import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const HASH_VERSION = "1";
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEMORY_BYTES = 128 * 1024 * 1024;
const SALT_PATTERN = new RegExp(`^[0-9a-f]{${SALT_BYTES * 2}}$`);
const KEY_PATTERN = new RegExp(`^[0-9a-f]{${KEY_BYTES * 2}}$`);

function isSupportedHash(storedHash: string): boolean {
  const parts = storedHash.split("$");

  return (
    parts.length === 7 &&
    parts[0] === "scrypt" &&
    parts[1] === HASH_VERSION &&
    parts[2] === String(SCRYPT_N) &&
    parts[3] === String(SCRYPT_R) &&
    parts[4] === String(SCRYPT_P) &&
    SALT_PATTERN.test(parts[5]) &&
    KEY_PATTERN.test(parts[6])
  );
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt);

  return [
    "scrypt",
    HASH_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");

  if (!isSupportedHash(storedHash)) {
    return false;
  }

  const salt = Buffer.from(parts[5], "hex");
  const expectedKey = Buffer.from(parts[6], "hex");
  const actualKey = await deriveKey(password, salt);

  return timingSafeEqual(actualKey, expectedKey);
}

let dummyHashPromise: Promise<string> | undefined;

async function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHashPromise;
}

export async function verifyPasswordOrDummy(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (storedHash !== null && isSupportedHash(storedHash)) {
    return verifyPassword(password, storedHash);
  }

  await verifyPassword(password, await getDummyHash());

  return false;
}
