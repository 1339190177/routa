import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSqliteDefaultWorkspace } from "../sqlite";

describe("ensureSqliteDefaultWorkspace", () => {
  let sqlite: BetterSqlite3.Database;

  beforeEach(() => {
    sqlite = new BetterSqlite3(":memory:");
    sqlite.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates the default workspace for an empty sqlite database", () => {
    ensureSqliteDefaultWorkspace(sqlite);

    const row = sqlite.prepare(`
      SELECT id, title, status, metadata
      FROM workspaces
      WHERE id = 'default'
    `).get() as { id: string; title: string; status: string; metadata: string } | undefined;

    expect(row).toMatchObject({
      id: "default",
      title: "Default Workspace",
      status: "active",
    });
    expect(JSON.parse(row?.metadata ?? "{}")).toHaveProperty("worktreeRoot");
  });

  it("does not overwrite an existing default workspace row", () => {
    sqlite.prepare(`
      INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("default", "Existing Default", "active", "{\"keep\":true}", 1, 1);

    ensureSqliteDefaultWorkspace(sqlite);

    const row = sqlite.prepare(`
      SELECT title, metadata
      FROM workspaces
      WHERE id = 'default'
    `).get() as { title: string; metadata: string };

    expect(row.title).toBe("Existing Default");
    expect(JSON.parse(row.metadata)).toEqual({ keep: true });
  });
});
