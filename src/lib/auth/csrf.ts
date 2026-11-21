export function getApplicationOrigin(): string {
  const configuredOrigin =
    process.env.APP_ORIGIN ??
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : undefined);

  if (!configuredOrigin) {
    throw new Error("APP_ORIGIN is required outside development.");
  }

  let originUrl: URL;

  try {
    originUrl = new URL(configuredOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid origin URL.");
  }

  if (
    (originUrl.protocol !== "https:" && originUrl.protocol !== "http:") ||
    originUrl.pathname !== "/" ||
    originUrl.search ||
    originUrl.hash
  ) {
    throw new Error("APP_ORIGIN must contain only an HTTP or HTTPS origin.");
  }

  return originUrl.origin;
}

export function hasValidCsrfHeaders(request: Request, applicationOrigin: string): boolean {
  return (
    request.headers.get("x-csrf-protection") === "1" &&
    request.headers.get("origin") === (applicationOrigin||"http://localhost:3000")
  );
}
