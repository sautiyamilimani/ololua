import { isIP } from "node:net";

export function getClientIpAddress(request: Request): string | null {
  const candidates = [
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")?.split(",", 1)[0],
  ];

  for (const candidate of candidates) {
    const address = candidate?.trim();

    if (address && isIP(address) !== 0) {
      return address;
    }
  }

  return process.env.NODE_ENV === "development" ? "127.0.0.1" : null;
}
