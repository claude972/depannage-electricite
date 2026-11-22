import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError } from "../../components/app/api";
import {
  acknowledgeUpload,
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
test("reconciliation never auto-confirms by name/date: it only lists candidates for the user", () => {
  const q = queue();
  q.items[0].status = "uncertain";
  const docs: StoredDocument[] = [
    // A different image with the same name stored 10 s before the queue started.
    { id: "old", intervention_id: "int-1", name: "a.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T21:59:50Z" },
    { id: "new", intervention_id: "int-1", name: "a.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T22:00:30Z" },
    { id: "other", intervention_id: "int-9", name: "a.jpg", mime_type: "image/jpeg", created_at: "2026-10-30T22:00:30Z" },
  ];
  const r = reconcileUncertain(q, docs);
  assert.equal(r.items[0].status, "uncertain", "no false confirmation");
  assert.equal(r.items[0].documentId, undefined);
  assert.deepEqual(r.items[0].candidates?.map((c) => c.id), ["old", "new"], "same-name documents of this dossier only");
  assert.equal(r.items[1].candidates, undefined, "pending items are untouched");
  // Only an explicit user acknowledgement of a listed candidate marks the photo as stored.
  const acked = acknowledgeUpload(r, "a", "new");
  assert.equal(acked.items[0].status, "done");
  assert.equal(acked.items[0].documentId, "new");
  const wrong = acknowledgeUpload(r, "a", "other");
  assert.equal(wrong.items[0].status, "uncertain", "an id that is not a candidate is ignored");
  // Without candidates the item stays uncertain and can only be re-sent explicitly.
  const none = reconcileUncertain(q, []);
  assert.equal(none.items[0].status, "uncertain");
  assert.deepEqual(none.items[0].candidates, []);
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
