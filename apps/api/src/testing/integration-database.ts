import { isIP } from "node:net";

export type IntegrationDatabaseMode = "local" | "ci";

export interface IntegrationDatabaseIdentity {
  database: unknown;
  role: unknown;
  owner: unknown;
  address: unknown;
  port: unknown;
  version: unknown;
}

export interface IntegrationDatabaseClient {
  query(text: string): Promise<{ rows: unknown[] }>;
}

export type IntegrationDatabaseEnvironment = Record<string, string | undefined>;

export function requireIntegrationDatabaseUrl(
  environment: IntegrationDatabaseEnvironment = process.env,
): string {
  const databaseUrl = environment.EVENTLY_INTEGRATION_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("EVENTLY_INTEGRATION_DATABASE_URL is required.");
  }
  return databaseUrl;
}

const localDatabases = new Set([
  "evently_verify_fresh",
  "evently_verify_upgrade",
  "evently_verify_clean",
]);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHost(host: string): boolean {
  return loopbackHosts.has(host.replace(/^\[|\]$/g, "").toLowerCase());
}

function resolveMode(
  environment: IntegrationDatabaseEnvironment,
): IntegrationDatabaseMode {
  const isCi = environment.CI === "true";
  const isGitHubActions = environment.GITHUB_ACTIONS === "true";
  const isExpectedWorkflow = environment.GITHUB_WORKFLOW === "CI";

  if (isCi && isGitHubActions && isExpectedWorkflow) {
    return "ci";
  }
  if (isCi || isGitHubActions || environment.GITHUB_WORKFLOW !== undefined) {
    throw new Error("Integration database environment is not approved.");
  }
  return "local";
}

function assertUrlTarget(
  databaseUrl: string,
  mode: IntegrationDatabaseMode,
): URL {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("Integration database target is invalid.");
  }

  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    target.port !== "5432" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error("Integration database target is not approved.");
  }

  const database = target.pathname.slice(1);
  if (mode === "local") {
    if (
      !isLoopbackHost(target.hostname) ||
      target.username !== "evently_verifier" ||
      target.password !== "" ||
      !localDatabases.has(database)
    ) {
      throw new Error("Integration database target is not approved.");
    }
    return target;
  }

  if (
    !["localhost", "127.0.0.1"].includes(target.hostname.toLowerCase()) ||
    target.username !== "evently" ||
    target.password.length === 0 ||
    database !== "evently_test"
  ) {
    throw new Error("Integration database target is not approved.");
  }
  return target;
}

export function assertIntegrationDatabaseTarget(
  databaseUrl: string,
  environment: IntegrationDatabaseEnvironment = process.env,
): IntegrationDatabaseMode {
  const mode = resolveMode(environment);
  assertUrlTarget(databaseUrl, mode);
  return mode;
}

function isPrivateServerAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [first, second] = octets;
    return (
      first === 10 ||
      (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  return version === 6 && /^f[cd]/i.test(address);
}

export function assertIntegrationDatabaseIdentity(
  identity: IntegrationDatabaseIdentity | undefined,
  databaseUrl: string,
  mode: IntegrationDatabaseMode,
): void {
  if (
    !identity ||
    typeof identity.database !== "string" ||
    typeof identity.role !== "string" ||
    typeof identity.owner !== "string" ||
    typeof identity.address !== "string" ||
    typeof identity.port !== "number" ||
    typeof identity.version !== "string" ||
    !/^17\d{4}$/.test(identity.version)
  ) {
    throw new Error(
      "Integration database identity is incomplete or unexpected.",
    );
  }

  const target = assertUrlTarget(databaseUrl, mode);
  const expectedDatabase =
    mode === "ci" ? "evently_test" : target.pathname.slice(1);
  const expectedRole = mode === "ci" ? "evently" : "evently_verifier";
  if (
    identity.database !== expectedDatabase ||
    identity.role !== expectedRole ||
    identity.owner !== expectedRole ||
    identity.port !== 5432
  ) {
    throw new Error(
      "Integration database identity is incomplete or unexpected.",
    );
  }

  if (mode === "local") {
    if (!isLoopbackHost(identity.address)) {
      throw new Error(
        "Integration database identity is incomplete or unexpected.",
      );
    }
    return;
  }

  if (!isPrivateServerAddress(identity.address)) {
    throw new Error(
      "Integration database identity is incomplete or unexpected.",
    );
  }
}

export async function verifyIntegrationDatabase(
  databaseUrl: string,
  client: IntegrationDatabaseClient,
  environment: IntegrationDatabaseEnvironment = process.env,
  connectedDatabaseUrl = databaseUrl,
): Promise<void> {
  if (connectedDatabaseUrl !== databaseUrl) {
    throw new Error("Integration database connection target does not match.");
  }
  const mode = assertIntegrationDatabaseTarget(databaseUrl, environment);
  const result = await client.query(
    `SELECT current_database() AS database,
            current_user AS role,
            pg_get_userbyid(datdba) AS owner,
            host(inet_server_addr()) AS address,
            inet_server_port() AS port,
            current_setting('server_version_num') AS version
       FROM pg_database
      WHERE datname = current_database()`,
  );
  assertIntegrationDatabaseIdentity(
    result.rows[0] as IntegrationDatabaseIdentity | undefined,
    databaseUrl,
    mode,
  );
}
