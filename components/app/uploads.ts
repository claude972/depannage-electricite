// Sequential upload of the photos attached to a freshly created dossier. Pure: the uploader
// and the progress sink are injected, so the retry behaviour is testable without a browser.
import { documentNameFor } from "../../lib/shared/document-policy";
import { ApiRequestError } from "./api";
import type { StoredDocument, UploadQueue } from "./types";

export type Uploader = (file: File, interventionId: string) => Promise<{ id: string }>;
// Network loss (0) or unusable reply (502) after the request left: the server may have stored
// the file. Anything else is a definite refusal.
export function classifyUploadError(e: unknown): "failed" | "uncertain" {
  if (e instanceof ApiRequestError && (e.status === 0 || e.status === 502)) return "uncertain";
  return "failed";
}
export async function processUploadQueue(
  queue: UploadQueue,
  upload: Uploader,
  alive: () => boolean,
  publish: (queue: UploadQueue) => void,
  options: { resendUncertain?: boolean } = {},
): Promise<UploadQueue> {
  let current = queue;
  for (const item of queue.items) {
    if (item.status === "done") continue; // never re-send a stored file
    if (item.status === "uncertain" && !options.resendUncertain) continue; // needs explicit confirmation
    if (!alive()) return current;
    current = {
      ...current,
      items: current.items.map((x) =>
        x.key === item.key ? { ...x, status: "uploading", error: undefined } : x,
      ),
    };
    publish(current);
    try {
      const doc = await upload(item.file, queue.interventionId);
      current = {
        ...current,
        items: current.items.map((x) =>
          x.key === item.key ? { ...x, status: "done", documentId: doc.id } : x,
        ),
      };
    } catch (e) {
      const status = classifyUploadError(e);
      current = {
        ...current,
        items: current.items.map((x) =>
          x.key === item.key ? { ...x, status, error: (e as Error).message } : x,
        ),
      };
    }
    publish(current);
  }
  return current;
}
// After an uncertain outcome, the application has no byte hash or upload correlation: it can
// only list the dossier's documents bearing the same file name as CANDIDATES for the user to
// open and recognise. The status stays "uncertain" until the user acknowledges a candidate
// (acknowledgeUpload) or explicitly re-sends the file.
export function reconcileUncertain(queue: UploadQueue, documents: StoredDocument[]): UploadQueue {
  return {
    ...queue,
    items: queue.items.map((item) => {
      if (item.status !== "uncertain") return item;
      const candidates = documents
        .filter(
          // E09: the same name rule as the server (clipped, blank ⇒ « document »), never the raw name.
          (d) => d.intervention_id === queue.interventionId && d.name === documentNameFor(item.file.name),
        )
        .map((d) => ({ id: d.id, name: d.name, created_at: d.created_at }));
      return { ...item, candidates };
    }),
  };
}
// Explicit user confirmation that a listed candidate IS the uploaded photo.
export function acknowledgeUpload(queue: UploadQueue, key: string, documentId: string): UploadQueue {
  return {
    ...queue,
    items: queue.items.map((item) =>
      item.key === key && item.status === "uncertain" && item.candidates?.some((c) => c.id === documentId)
        ? { ...item, status: "done", documentId, error: undefined }
        : item,
    ),
  };
}
export function uploadSummary(queue: UploadQueue): string {
  const done = queue.items.filter((i) => i.status === "done").length;
  const failed = queue.items.filter((i) => i.status === "failed").length;
  const uncertain = queue.items.filter((i) => i.status === "uncertain").length;
  const plural = done > 1 ? "s" : "";
  const parts = [`${done} photo${plural} enregistrée${plural}`];
  if (failed) parts.push(`${failed} refusée${failed > 1 ? "s" : ""}`);
  if (uncertain) parts.push(`${uncertain} au résultat incertain`);
  if (!failed && !uncertain) return `${parts[0]} dans le dossier.`;
  return `${parts.join(", ")}. La demande est bien créée : vérifiez les photos du dossier avant tout nouvel envoi.`;
}
export const allUploaded = (queue: UploadQueue) => queue.items.every((i) => i.status === "done");
export const hasOpenItems = (queue: UploadQueue) =>
  queue.items.some((i) => i.status !== "done");
// Queues are kept per dossier; a new request never overwrites an older queue.
export function upsertQueue(queues: UploadQueue[], queue: UploadQueue): UploadQueue[] {
  return [...queues.filter((q) => q.interventionId !== queue.interventionId), queue];
}
export const removeQueue = (queues: UploadQueue[], interventionId: string) =>
  queues.filter((q) => q.interventionId !== interventionId);
