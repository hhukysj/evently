export interface BrowserHttpFailure {
  status: number;
  method: string;
  url: string;
}

export interface ExpectedHttpFailure {
  status: number;
  method: string;
  origin: string;
  pathname: string;
}

export function classifyHttpFailure(
  failure: BrowserHttpFailure,
  expectedFailures: ExpectedHttpFailure[],
): boolean {
  let url: URL;
  try {
    url = new URL(failure.url);
  } catch {
    return false;
  }

  if (
    failure.status === 401 &&
    failure.method === "GET" &&
    url.origin === "http://127.0.0.1:5174" &&
    url.pathname === "/api/v1/auth/me"
  ) {
    return true;
  }

  const expectedIndex = expectedFailures.findIndex(
    (expected) =>
      expected.status === failure.status &&
      expected.method === failure.method &&
      expected.origin === url.origin &&
      expected.pathname === url.pathname,
  );
  if (expectedIndex === -1) {
    return false;
  }
  expectedFailures.splice(expectedIndex, 1);
  return true;
}

export function formatHttpFailure(failure: BrowserHttpFailure): string {
  let url: string;
  try {
    const parsedUrl = new URL(failure.url);
    url = `${parsedUrl.origin}${parsedUrl.pathname}${
      parsedUrl.search ? "?[redacted]" : ""
    }`;
  } catch {
    url = "<invalid-url>";
  }
  return `${failure.status} ${failure.method} ${url}`;
}

export function assertNoUnexpectedHttpFailures(
  failures: readonly string[],
): void {
  if (failures.length > 0) {
    throw new Error(`Unexpected HTTP failures:\n${failures.join("\n")}`);
  }
}
