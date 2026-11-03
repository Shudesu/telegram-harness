import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { D1Repo, createNodeSqliteD1 } from "./d1.js";

describe("schema.sql", () => {
  it("applies on Node sqlite and stores a bot without a token column value", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(here, "..", "schema.sql"), "utf8");
    const database = new DatabaseSync(":memory:");
    database.exec(sql);
    const repo = new D1Repo(createNodeSqliteD1(database));
    await repo.insertBot({
      id: "bot-1",
      name: "Main",
      tokenEnvName: "TELEGRAM_BOT_TOKEN_MAIN",
      createdAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    const stored = await repo.getBot("bot-1");
    expect(stored?.tokenEnvName).toBe("TELEGRAM_BOT_TOKEN_MAIN");
    const columns = database.prepare("PRAGMA table_info(bots)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain("token");
  });
});
