export const MAX_AUTH_REQUEST_BYTES = 16 * 1024;

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false };

export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  const reader = request.body?.getReader();

  if (!reader) {
    return { ok: false };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAX_AUTH_REQUEST_BYTES) {
      await reader.cancel();
      return { ok: false };
    }

    chunks.push(value);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
