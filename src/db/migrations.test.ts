import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("social report schema upgrade", () => {
  it("preserves legacy reports and enforces the producer ownership contract", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(readFileSync("drizzle/0000_init.sql", "utf8"));
      db.exec(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at)
        VALUES ('existing', 'reporter', 'thread', 'target', 'Existing report', 1)`);
      db.exec(readFileSync("drizzle/0001_abuse_controls.sql", "utf8"));
      db.exec(readFileSync("drizzle/0002_report_resolution_ownership.sql", "utf8"));
      expect(db.prepare("SELECT * FROM reports WHERE id = 'existing'").get()).toMatchObject({
        reason: "Existing report",
        status: "open",
        resolution_operation_id: null,
      });
      db.exec(`INSERT INTO reports
        (id, reporter_id, target_type, target_id, reason, resolution_operation_id, created_at)
        VALUES ('new', 'reporter', 'thread', 'another-target', 'New report', NULL, 2)`);
      expect(db.prepare("SELECT COUNT(*) AS count FROM reports").get()).toMatchObject({ count: 2 });
      expect(() =>
        db.exec("UPDATE reports SET resolution_operation_id = 'forged' WHERE id = 'existing'"),
      ).toThrow(/report terminal state does not match its resolution owner/);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
