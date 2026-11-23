export const DEFAULT_CUSTOMER_PAGE_SIZE = 50;
export const MAX_CUSTOMER_PAGE_SIZE = 100;
export const MAX_CUSTOMER_OFFSET = 10_000;

export type CustomerPage = {
  limit: number;
  offset: number;
};

function parseIntegerParameter(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseCustomerPage(
  searchParams: URLSearchParams,
): CustomerPage | null {
  if (
    searchParams.getAll("limit").length > 1 ||
    searchParams.getAll("offset").length > 1
  ) {
    return null;
  }

  const requestedLimit =
    searchParams.get("limit") === null
      ? DEFAULT_CUSTOMER_PAGE_SIZE
      : parseIntegerParameter(searchParams.get("limit"));
  const requestedOffset =
    searchParams.get("offset") === null
      ? 0
      : parseIntegerParameter(searchParams.get("offset"));

  if (
    requestedLimit === null ||
    requestedLimit < 1 ||
    requestedLimit > MAX_CUSTOMER_PAGE_SIZE ||
    requestedOffset === null ||
    requestedOffset > MAX_CUSTOMER_OFFSET
  ) {
    return null;
  }

  return { limit: requestedLimit, offset: requestedOffset };
}
