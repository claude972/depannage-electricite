import test from "node:test";
import assert from "node:assert/strict";
import { allUploaded, processUploadQueue, uploadSummary } from "../../components/app/uploads";
import type { UploadQueue } from "../../components/app/types";

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
const queue = (): UploadQueue => ({
  interventionId: "int-1",
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
  assert.match(uploadSummary(first), /2 photos enregistrées, 1 en échec\. La demande est bien créée/);
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
