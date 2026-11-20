import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.EMAIL_OUTBOX_ENCRYPTION_KEY?.trim();

  if (!encodedKey) {
    throw new Error("EMAIL_OUTBOX_ENCRYPTION_KEY is required.");
  }

  const key = Buffer.from(encodedKey, "base64");

  if (key.length !== KEY_BYTES || key.toString("base64") !== encodedKey) {
    throw new Error("EMAIL_OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }

  return key;
}

export function assertSecretPayloadEncryptionConfigured(): void {
  getEncryptionKey();
}

export function encryptSecretPayload(value: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return Buffer.concat([
    Buffer.from([FORMAT_VERSION]),
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptSecretPayload(encrypted: Uint8Array): string {
  const payload = Buffer.from(encrypted);

  if (payload.length < 1 + NONCE_BYTES + TAG_BYTES || payload[0] !== FORMAT_VERSION) {
    throw new Error("Encrypted email payload has an unsupported format.");
  }

  const nonceStart = 1;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    payload.subarray(nonceStart, tagStart),
  );
  decipher.setAuthTag(payload.subarray(tagStart, ciphertextStart));

  return Buffer.concat([
    decipher.update(payload.subarray(ciphertextStart)),
    decipher.final(),
  ]).toString("utf8");
}
