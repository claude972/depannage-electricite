// Sequential upload of the photos attached to a freshly created dossier. Pure: the uploader
// and the progress sink are injected, so the retry behaviour is testable without a browser.
import type { UploadQueue } from "./types";

export type Uploader = (file: File, interventionId: string) => Promise<{ id: string }>;
export async function processUploadQueue(
  queue: UploadQueue,
  upload: Uploader,
  alive: () => boolean,
  publish: (queue: UploadQueue) => void,
): Promise<UploadQueue> {
  let current = queue;
  for (const item of queue.items) {
    if (item.status === "done") continue; // never re-send a stored file
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
      current = {
        ...current,
        items: current.items.map((x) =>
          x.key === item.key ? { ...x, status: "failed", error: (e as Error).message } : x,
        ),
      };
    }
    publish(current);
  }
  return current;
}
export function uploadSummary(queue: UploadQueue): string {
  const done = queue.items.filter((i) => i.status === "done").length;
  const failed = queue.items.filter((i) => i.status === "failed").length;
  const plural = done > 1 ? "s" : "";
  if (!failed) return `${done} photo${plural} enregistrée${plural} dans le dossier.`;
  return `${done} photo${plural} enregistrée${plural}, ${failed} en échec. La demande est bien créée : réessayez l’envoi des photos restantes depuis le dossier.`;
}
export const allUploaded = (queue: UploadQueue) => queue.items.every((i) => i.status === "done");
