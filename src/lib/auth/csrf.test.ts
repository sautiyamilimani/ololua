import assert from "node:assert/strict";
import test from "node:test";
import { hasValidCsrfHeaders } from "./csrf";

const applicationOrigin = "https://ololua.example";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request(`${applicationOrigin}/api/auth/login`, {
    method: "POST",
    headers,
  });
}

test("CSRF validation requires the custom header and exact origin", () => {
  assert.equal(
    hasValidCsrfHeaders(
      requestWithHeaders({
        "x-csrf-protection": "1",
        origin: applicationOrigin,
      }),
      applicationOrigin,
    ),
    true,
  );

  assert.equal(
    hasValidCsrfHeaders(
      requestWithHeaders({
        "x-csrf-protection": "1",
        origin: "https://attacker.example",
        "sec-fetch-site": "same-origin",
      }),
      applicationOrigin,
    ),
    false,
  );

  assert.equal(
    hasValidCsrfHeaders(
      requestWithHeaders({
        origin: applicationOrigin,
      }),
      applicationOrigin,
    ),
    false,
  );
});
