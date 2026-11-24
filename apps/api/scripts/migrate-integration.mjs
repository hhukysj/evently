import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const APPROVED_DATABASE_URL =
  "postgresql://evently_verifier@127.0.0.1:5432/evently_verify_clean";

const EXPECTED_MIGRATION_TAGS = [
  "0000_phase1-baseline",
  "0001_breezy_cannonball",
  "0002_misty_major_mapleleaf",
  "0003_slimy_junta",
  "0004_giant_next_avengers",
  "0005_icy_stone_men",
  "0006_known_eternity",
  "0007_dusty_falcon",
  "0008_heavy_the_spike",
  "0009_evently_booking_foundation",
  "0010_booking_cancellation_conversations",
];

const EXPECTED_HISTORY_COLUMNS = [
  ["id", "integer", "NO"],
  ["hash", "text", "NO"],
  ["created_at", "bigint", "YES"],
];

const apiRoot = fileURLToPath(new URL("..", import.meta.url));

function requireApprovedTarget() {
  const databaseUrl = process.env.EVENTLY_INTEGRATION_DATABASE_URL;
  if (databaseUrl !== APPROVED_DATABASE_URL) {
    throw new Error("Integration migration target is not approved.");
  }

  const password = process.env.PGPASSWORD;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("PGPASSWORD is required for integration migrations.");
  }

  return { databaseUrl, password };
}

function readJournalMigrations() {
  const journalPath = join(apiRoot, "drizzle", "meta", "_journal.json");
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new Error("Migration journal is missing or invalid.");
  }

  if (
    journal.version !== "7" ||
    journal.dialect !== "postgresql" ||
    !Array.isArray(journal.entries) ||
    journal.entries.length !== EXPECTED_MIGRATION_TAGS.length
  ) {
    throw new Error("Migration journal does not match the approved history.");
  }

  let previousTimestamp = 0;
  return journal.entries.map((entry, index) => {
    if (
      entry.idx !== index ||
      entry.version !== journal.version ||
      entry.tag !== EXPECTED_MIGRATION_TAGS[index] ||
      entry.breakpoints !== true ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= previousTimestamp
    ) {
      throw new Error("Migration journal ordering is unexpected.");
    }
    previousTimestamp = entry.when;

    let migrationSql;
    try {
      migrationSql = readFileSync(
        join(apiRoot, "drizzle", `${entry.tag}.sql`),
        "utf8",
      );
    } catch {
      throw new Error("A journal migration file is missing.");
    }

    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(migrationSql).digest("hex"),
    };
  });
}

function assertDatabaseIdentity(identity) {
  if (
    !identity ||
    identity.database !== "evently_verify_clean" ||
    identity.role !== "evently_verifier" ||
    identity.owner !== "evently_verifier" ||
    identity.address !== "127.0.0.1" ||
    identity.port !== 5432 ||
    typeof identity.version !== "string" ||
    !/^17\d{4}$/.test(identity.version)
  ) {
    throw new Error("Connected database identity is not approved.");
  }
}

async function assertOnlyBookingMigrationPending(client, migrations) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;

    const identityResult = await client.query(`
      SELECT current_database() AS database,
             current_user AS role,
             pg_get_userbyid(datdba) AS owner,
             host(inet_server_addr()) AS address,
             inet_server_port() AS port,
             current_setting('server_version_num') AS version
        FROM pg_database
       WHERE datname = current_database()`);
    assertDatabaseIdentity(identityResult.rows[0]);

    const schemaResult = await client.query(`
      SELECT pg_get_userbyid(nspowner) AS owner
        FROM pg_namespace
       WHERE nspname = 'drizzle'`);
    if (
      schemaResult.rows.length !== 1 ||
      schemaResult.rows[0].owner !== "evently_verifier"
    ) {
      throw new Error("Migration history schema is missing or unexpected.");
    }

    const relationResult = await client.query(`
      SELECT c.oid,
             c.relkind,
             pg_get_userbyid(c.relowner) AS owner,
             (SELECT count(*)::int
                FROM pg_constraint con
               WHERE con.conrelid = c.oid) AS constraint_count,
             EXISTS (
               SELECT 1
                 FROM pg_constraint con
                 JOIN pg_attribute a
                   ON a.attrelid = c.oid
                  AND a.attname = 'id'
                  AND NOT a.attisdropped
                WHERE con.conrelid = c.oid
                  AND con.contype = 'p'
                  AND con.conkey = ARRAY[a.attnum]::smallint[]
             ) AS id_is_primary_key,
             (SELECT count(*)::int
                FROM pg_index i
               WHERE i.indrelid = c.oid) AS index_count,
             (SELECT count(*)::int
                FROM pg_trigger t
               WHERE t.tgrelid = c.oid
                 AND NOT t.tgisinternal) AS user_trigger_count,
             pg_get_serial_sequence(
               'drizzle.__drizzle_migrations', 'id'
             ) AS id_sequence,
             seq.relname AS sequence_name,
             seq_ns.nspname AS sequence_schema,
             seq.relkind AS sequence_kind,
             pg_get_userbyid(seq.relowner) AS sequence_owner,
             seq_info.seqstart AS sequence_start,
             seq_info.seqincrement AS sequence_increment,
             seq_info.seqmin AS sequence_min,
             seq_info.seqmax AS sequence_max,
             seq_info.seqcache AS sequence_cache,
             seq_info.seqcycle AS sequence_cycles,
             pg_get_expr(id_default.adbin, id_default.adrelid) AS id_default,
             EXISTS (
               SELECT 1
                 FROM pg_depend d
                WHERE d.classid = 'pg_attrdef'::regclass
                  AND d.objid = id_default.oid
                  AND d.refclassid = 'pg_class'::regclass
                  AND d.refobjid = seq.oid
             ) AS id_default_uses_owned_sequence
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute id_column
          ON id_column.attrelid = c.oid
         AND id_column.attname = 'id'
         AND NOT id_column.attisdropped
        LEFT JOIN pg_attrdef id_default
          ON id_default.adrelid = c.oid
         AND id_default.adnum = id_column.attnum
        LEFT JOIN pg_class seq
          ON seq.oid = to_regclass(pg_get_serial_sequence(
            'drizzle.__drizzle_migrations', 'id'
          ))
        LEFT JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
        LEFT JOIN pg_sequence seq_info ON seq_info.seqrelid = seq.oid
       WHERE n.nspname = 'drizzle'
         AND c.relname = '__drizzle_migrations'`);
    if (relationResult.rows.length !== 1) {
      throw new Error("Migration history table is missing or unexpected.");
    }

    const relation = relationResult.rows[0];
    if (
      relation.relkind !== "r" ||
      relation.owner !== "evently_verifier" ||
      relation.constraint_count !== 1 ||
      relation.id_is_primary_key !== true ||
      relation.index_count !== 1 ||
      relation.user_trigger_count !== 0 ||
      typeof relation.id_sequence !== "string" ||
      relation.id_sequence.length === 0 ||
      relation.sequence_name !== "__drizzle_migrations_id_seq" ||
      relation.sequence_schema !== "drizzle" ||
      relation.sequence_kind !== "S" ||
      relation.sequence_owner !== "evently_verifier" ||
      Number(relation.sequence_start) !== 1 ||
      Number(relation.sequence_increment) !== 1 ||
      Number(relation.sequence_min) !== 1 ||
      Number(relation.sequence_max) !== 2147483647 ||
      Number(relation.sequence_cache) !== 1 ||
      relation.sequence_cycles !== false ||
      typeof relation.id_default !== "string" ||
      !relation.id_default.startsWith("nextval(") ||
      relation.id_default_uses_owned_sequence !== true
    ) {
      throw new Error("Migration history table structure is unexpected.");
    }

    const columnResult = await client.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'drizzle'
         AND table_name = '__drizzle_migrations'
       ORDER BY ordinal_position`);
    const actualColumns = columnResult.rows.map((column) => [
      column.column_name,
      column.data_type,
      column.is_nullable,
    ]);
    if (JSON.stringify(actualColumns) !== JSON.stringify(EXPECTED_HISTORY_COLUMNS)) {
      throw new Error("Migration history table columns are unexpected.");
    }

    const historyResult = await client.query(`
      SELECT hash, created_at::text AS created_at
        FROM drizzle.__drizzle_migrations
       ORDER BY created_at, id`);
    const appliedMigrations = migrations.slice(0, 10);
    if (historyResult.rows.length !== appliedMigrations.length) {
      throw new Error("Applied migration history is incomplete or unexpected.");
    }

    for (let index = 0; index < appliedMigrations.length; index += 1) {
      const expected = appliedMigrations[index];
      const recorded = historyResult.rows[index];
      if (
        recorded.hash !== expected.hash ||
        recorded.created_at !== String(expected.when)
      ) {
        throw new Error("Applied migration hash or timestamp does not match.");
      }
    }

    const latestAppliedTimestamp = Number(
      historyResult.rows.at(-1)?.created_at,
    );
    const pendingMigrations = migrations.filter(
      (migration) => migration.when > latestAppliedTimestamp,
    );
    if (
      latestAppliedTimestamp !== appliedMigrations.at(-1)?.when ||
      pendingMigrations.length !== 1 ||
      pendingMigrations[0]?.tag !== "0010_booking_cancellation_conversations"
    ) {
      throw new Error("Migration 0010 is not the only pending migration.");
    }
  } finally {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
  }
}

let client;
let exitCode = 0;
let failureMessage = "Integration migration failed; no credentials were logged.";

try {
  const { databaseUrl, password } = requireApprovedTarget();
  const migrations = readJournalMigrations();

  client = new Client({
    connectionString: databaseUrl,
    password,
    connectionTimeoutMillis: 3000,
  });
  await client.connect();

  failureMessage = "Integration database identity or migration preflight failed.";
  await assertOnlyBookingMigrationPending(client, migrations);

  failureMessage = "Integration migration failed.";
  const db = drizzle(client, { logger: false });
  await migrate(db, { migrationsFolder: join(apiRoot, "drizzle") });
} catch {
  console.error(failureMessage);
  exitCode = 1;
} finally {
  if (client) {
    try {
      await client.end();
    } catch {
      console.error("Integration database connection could not be closed cleanly.");
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
