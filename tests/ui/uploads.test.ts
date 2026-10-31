import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError } from "../../components/app/api";
import {
  allUploaded,
  classifyUploadError,
  processUploadQueue,
  reconcileUncertain,
  removeQueue,
  uploadSummary,
  upsertQueue,
} from "../../components/app/uploads";
import type { StoredDocument, UploadQueue } from "../../components/app/types";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
const queue = (interventionId = "int-1"): UploadQueue => ({
  interventionId,
  startedAt: "2026-10-30T22:00:00Z",
  items: [
    { key: "a", file: file("a.jpg"), status: "pending" },
    { key: "b", file: file("b.jpg"), status: "pending" },
    { key: "c", file: file("c.jpg"), status: "pending" },
  ],
});

test("a partial failure keeps the dossier and leaves only the failed photos to retry", async () => {
  const sent: string[] = [];
  const first = await processUploadQueue(
    queue(),
    async (f) => {
      sent.push(f.name);
      if (f.name === "b.jpg") throw new Error("Le contenu du fichier ne correspond pas à un format autorisé.");
      return { id: `doc-${f.name}` };
    },
    () => true,
    () => {},
  );
  assert.deepEqual(sent, ["a.jpg", "b.jpg", "c.jpg"]);
  assert.deepEqual(first.items.map((i) => i.status), ["done", "failed", "done"]);
  assert.equal(allUploaded(first), false);
  assert.match(uploadSummary(first), /2 photos enregistrées, 1 refusée\. La demande est bien créée/);
  // Retry: only the failed item is sent again; stored files are never re-sent.
  const resent: string[] = [];
  const second = await processUploadQueue(
    first,
    async (f) => {
      resent.push(f.name);
      return { id: `doc-${f.name}` };
    },
    () => true,
    () => {},
  );
  assert.deepEqual(resent, ["b.jpg"]);
  assert.equal(allUploaded(second), true);
  assert.equal(second.interventionId, "int-1", "same dossier, never recreated");
});
test("an identity change stops the queue before the next file and reports progress so far", async () => {
  let alive = true;
  const sent: string[] = [];
  const published: string[][] = [];
  const result = await processUploadQueue(
    queue(),
    async (f) => {
      sent.push(f.name);
      if (f.name === "a.jpg") alive = false; // logout while the first upload completes
      return { id: `doc-${f.name}` };
    },
    () => alive,
    (q) => published.push(q.items.map((i) => i.status)),
  );
  assert.deepEqual(sent, ["a.jpg"]);
  assert.deepEqual(result.items.map((i) => i.status), ["done", "pending", "pending"]);
  assert.ok(published.length >= 2);
});
test("summary wording for a full success", () => {
  const q = queue();
  q.items = q.items.map((i) => ({ ...i, status: "done" as const }));
  assert.equal(uploadSummary(q), "3 photos enregistrées dans le dossier.");
});

test("network loss or an unusable reply is uncertain, not failed, and is not re-sent blindly", async () => {
  assert.equal(classifyUploadError(new ApiRequestError(0, "coupure")), "uncertain");
  assert.equal(classifyUploadError(new ApiRequestError(502, "corps invalide")), "uncertain");
  assert.equal(classifyUploadError(new ApiRequestError(422, "format")), "failed");
  const sent: string[] = [];
  const first = await processUploadQueue(
    queue(),
    async (f) => {
      sent.push(f.name);
      if (f.name === "a.jpg") throw new ApiRequestError(0, "coupure");
      if (f.name === "b.jpg") throw new ApiRequestError(422, "refusé");
      return { id: "doc-c" };
    },
    () => true,
    () => {},
  );
  assert.deepEqual(first.items.map((i) => i.status), ["uncertain", "failed", "done"]);
  assert.match(uploadSummary(first), /1 refusée, 1 au résultat incertain/);
  assert.doesNotMatch(uploadSummary(first), /n’a pas été enregistrée/);
  // Default retry: the refused file is re-sent, the uncertain one is NOT.
  const resent: string[] = [];
  const second = await processUploadQueue(first, async (f) => {
    resent.push(f.name);
    return { id: `doc-${f.name}` };
  }, () => true, () => {});
  assert.deepEqual(resent, ["b.jpg"]);
  assert.equal(second.items[0].status, "uncertain");
  // Explicit confirmation re-sends the uncertain file.
  const third = await processUploadQueue(second, async (f) => {
    resent.push(f.name);
    return { id: `doc-${f.name}` };
  }, () => true, () => {}, { resendUncertain: true });
  assert.deepEqual(resent, ["b.jpg", "a.jpg"]);
  assert.equal(allUploaded(third), true);
});
test("reconciliation marks an uncertain photo as stored when the dossier already holds it", () => {
  const q = queue();
  q.items[0].status = "uncertain";
  const docs: StoredDocument[] = [
    { id: "d1", intervention_id: "int-1", name: "a.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T22:00:30Z" },
    { id: "d0", intervention_id: "int-1", name: "b.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T20:00:00Z" },
    { id: "dX", intervention_id: "other", name: "c.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T22:00:30Z" },
  ];
  const r = reconcileUncertain(q, docs);
  assert.equal(r.items[0].status, "done");
  assert.equal(r.items[0].documentId, "d1");
  assert.equal(r.items[1].status, "pending", "only uncertain items are reconciled");
  const older = reconcileUncertain({ ...q, startedAt: "2026-10-30T23:00:00Z" }, docs);
  assert.equal(older.items[0].status, "uncertain", "a document stored long before the queue is not claimed");
});
test("queues are kept per dossier: a second request never overwrites an older failed queue", () => {
  const a = queue("int-1");
  a.items[1].status = "failed";
  let all = upsertQueue([], a);
  const b = queue("int-2");
  all = upsertQueue(all, b);
  assert.equal(all.length, 2);
  assert.equal(all.find((q) => q.interventionId === "int-1")?.items[1].status, "failed");
  all = removeQueue(all, "int-2");
  assert.deepEqual(all.map((q) => q.interventionId), ["int-1"]);
});
