import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertDatabaseFilePath, openNodeSqliteRepo, resolveSqlitePath } from "./sqlite.js";

describe("node sqlite repo", () => {
  it("rejects a database file inside the repo outside .local", () => {
    expect(() => assertDatabaseFilePath(join(process.cwd(), "harness.sqlite"))).toThrow("database_path_rejected");
    expect(() => assertDatabaseFilePath(join(process.cwd(), ".local", "harness.sqlite"))).not.toThrow();
    const outside = join(mkdtempSync(join(tmpdir(), "tg-db-")), "harness.sqlite");
    expect(() => assertDatabaseFilePath(outside)).not.toThrow();
  });

  it("defaults the path outside the repo and honors TELEGRAM_DB_PATH", () => {
    expect(resolveSqlitePath({}, "/home/owner")).toBe(
      join("/home/owner", ".local", "share", "telegram-harness", "telegram-harness.sqlite"),
    );
    expect(resolveSqlitePath({ TELEGRAM_DB_PATH: "" }, "/home/owner")).toBe(
      join("/home/owner", ".local", "share", "telegram-harness", "telegram-harness.sqlite"),
    );
    expect(resolveSqlitePath({ TELEGRAM_DB_PATH: "  /var/lib/telegram-harness.sqlite  " })).toBe(
      "/var/lib/telegram-harness.sqlite",
    );
  });

  it("keeps bots, account actions, and selfUserId across a restart", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "tg-db-")), "harness.sqlite");
    const first = openNodeSqliteRepo(path);
    expect((statSync(path).mode & 0o777) === 0o600).toBe(true);
    await first.repo.insertBot({
      id: "bot-1",
      name: "Main",
      tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN",
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    await first.repo.insertAccountAction({
      id: "action-1",
      action: "create_channel",
      status: "pending",
      payload: { title: "Persisted" },
      summary: "create",
      scheduledAt: null,
      approvedAt: null,
      error: null,
      result: null,
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    await first.repo.saveUserState({
      sessionEnvName: "TELEGRAM_USER_SESSION",
      selfUserId: "42",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    first.close();

    const second = openNodeSqliteRepo(path);
    expect((await second.repo.getBot("bot-1"))?.name).toBe("Main");
    expect((await second.repo.getAccountAction("action-1"))?.status).toBe("pending");
    expect((await second.repo.getUserState())?.selfUserId).toBe("42");
    expect((statSync(path).mode & 0o777) === 0o600).toBe(true);
    second.close();
  });

  it("applies the same tables and columns as schema.sql", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(here, "..", "schema.sql"), "utf8");
    const baseline = new DatabaseSync(":memory:");
    baseline.exec(sql);
    const path = join(mkdtempSync(join(tmpdir(), "tg-db-")), "harness.sqlite");
    const opened = openNodeSqliteRepo(path);
    opened.close();
    const migrated = new DatabaseSync(path);
    try {
      expect(schemaShape(baseline)).toEqual(schemaShape(migrated));
    } finally {
      baseline.close();
      migrated.close();
    }
  });
});

function schemaShape(database: DatabaseSync): { tables: Record<string, string[]>; indexes: string[] } {
  const tables = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name",
    )
    .all() as { name: string }[];
  const columns: Record<string, string[]> = {};
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table.name)) throw new Error("unexpected_table");
    const info = database.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[];
    columns[table.name] = info.map((column) => column.name);
  }
  const indexes = (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
  return { tables: columns, indexes };
}
