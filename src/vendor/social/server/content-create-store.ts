import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { contentCreateOperations } from "../db/schema";
import type { StoredContentCreateOperation } from "./content-create";

type StoredContentCreateOperationRow = typeof contentCreateOperations.$inferSelect;

function presentContentCreateOperation(
  row: StoredContentCreateOperationRow | undefined,
): StoredContentCreateOperation | null {
  if (!row) return null;
  return {
    id: row.id,
    contractVersion: row.contractVersion,
    fingerprint: row.fingerprint,
    kind: row.kind,
    actorId: row.actorId,
    requestedThreadId: row.requestedThreadId,
    requestedForumSlug: row.requestedForumSlug,
    resultPostId: row.resultPostId,
    resultThreadId: row.resultThreadId,
  };
}

export async function readContentCreateOperation(
  db: Db,
  operationId: string,
): Promise<StoredContentCreateOperation | null> {
  const [row] = await db
    .select()
    .from(contentCreateOperations)
    .where(eq(contentCreateOperations.id, operationId))
    .limit(1);
  return presentContentCreateOperation(row);
}
