import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { D1Repo, createNodeSqliteD1 } from "./d1.js";

const SIDE_FILES = ["", "-journal", "-wal", "-shm"];

export function assertDatabaseFilePath(path: string): void {
  const resolved = resolve(path);
  const cwd = resolve(process.cwd());
  const localDir = resolve(cwd, ".local");
  const insideCwd = resolved === cwd || resolved.startsWith(cwd + sep);
  const insideLocal = resolved === localDir || resolved.startsWith(localDir + sep);
  if (insideCwd && !insideLocal) throw new Error("database_path_rejected");
  if (resolved.includes(`${sep}.git${sep}`) || resolved.endsWith(`${sep}.git`)) throw new Error("database_path_rejected");
}

export function defaultSqlitePath(home = homedir()): string {
  return join(home, ".local", "share", "telegram-harness", "telegram-harness.sqlite");
}

export function resolveSqlitePath(env: { TELEGRAM_DB_PATH?: string }, home = homedir()): string {
  const configured = env.TELEGRAM_DB_PATH?.trim();
  if (configured) return configured;
  return defaultSqlitePath(home);
}

export interface NodeSqliteHandle {
  repo: D1Repo;
  path: string;
  close(): void;
}

export function openNodeSqliteRepo(path: string): NodeSqliteHandle {
  assertDatabaseFilePath(path);
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });
  if (!existsSync(resolved)) {
    const fd = openSync(resolved, "w", 0o600);
    closeSync(fd);
  }
  restrictFile(resolved);
  const database = new DatabaseSync(resolved);
  try {
    applyMigrations(database);
  } catch (error) {
    database.close();
    throw error;
  }
  restrictFile(resolved);
  return {
    repo: new D1Repo(createNodeSqliteD1(database)),
    path: resolved,
    close() {
      database.close();
    },
  };
}

function restrictFile(path: string): void {
  for (const suffix of SIDE_FILES) {
    const candidate = path + suffix;
    if (existsSync(candidate)) chmodSync(candidate, 0o600);
  }
}

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

function applyMigrations(database: DatabaseSync): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
  const applied = new Set(
    (database.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((row) => row.name),
  );
  const files = readdirSync(migrationsDir())
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDir(), name), "utf8");
    database.exec("BEGIN");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
