// CLI-02 — request photos shared with the artisans eligible to the offer, BEFORE assignment.
// Same server contract as the mobile app: GET/POST /api/interventions/<id>/offer-photos
// (read_mission_offer_photos / set_mission_offer_photo). The server decides everything: requester
// only, dossier still « requested » without artisan, own image documents, six shared at most.
// Withdrawing a photo from the offer does NOT delete the document: it stays in the private dossier.
// True deletion is a separate, explicit command (DELETE /api/documents?id=): the requester's own
// request photo, only while the dossier is still « requested » without artisan; the server removes
// the row and the private file. The artisan side reads the shared photos with GET (list, ?photo=).
import { z } from "zod";

export const OFFER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const OFFER_PHOTO_LIMIT = 6;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const list = z.object({ items: z.array(z.object({ id: uuid }).strict()).max(OFFER_PHOTO_LIMIT) }).strict();
const receipt = z.object({ shared: z.boolean() }).strict();

export const offerPhotosPath = (interventionId: string) => `/api/interventions/${encodeURIComponent(interventionId)}/offer-photos`;
/** Re-encoded image of ONE shared photo, served only to the requester and the eligible artisans. */
export const offerPhotoSrc = (interventionId: string, photoId: string) => `${offerPhotosPath(interventionId)}?photo=${encodeURIComponent(photoId)}`;
export const deletePhotoPath = (documentId: string) => `/api/documents?id=${encodeURIComponent(documentId)}`;
/** True only when the server confirms the deletion of exactly this document. */
export function confirmsDeletion(body: unknown, documentId: string): boolean {
  const r = z.object({ deleted: z.literal(true), id: uuid }).strict().safeParse(body);
  return r.success && r.data.id.toLowerCase() === documentId.toLowerCase();
}
/** Honest reason of a refused deletion, from the HTTP status of the command. */
export function deletePhotoError(status: number): string {
  if (status === 409) return "La demande n’est plus en recherche d’artisan (ou la photo est utilisée dans le dossier) : elle ne peut plus être supprimée. Actualisez le dossier.";
  if (status === 401 || status === 403 || status === 404) return "Cette photo n’est plus disponible ou ne peut pas être supprimée par ce compte.";
  if (status === 429) return "Trop de tentatives. Patientez une minute puis réessayez.";
  return "La suppression n’a pas pu être vérifiée. Actualisez le dossier avant de réessayer.";
}
export const OFFER_GALLERY_COPY = {
  title: "Photos choisies par le client",
  intro: "Le client a choisi de montrer ces photos aux artisans éligibles avant attribution. Elles restent privées : ne les enregistrez pas et ne les transmettez pas.",
  loading: "Lecture des photos partagées…",
  loadFailed: "Les photos partagées n’ont pas pu être lues.",
  empty: "Aucune photo partagée pour cette offre.",
  photoFailed: "Cette photo est momentanément indisponible ou n’est plus partagée.",
  reloadPhoto: "Recharger la photo",
} as const;
/** Ids of the photos currently shared, lower-cased; null when the body breaks the contract. */
export function parseSharedIds(body: unknown): string[] | null {
  const r = list.safeParse(body);
  return r.success ? r.data.items.map((item) => item.id.toLowerCase()) : null;
}
/** True only when the server confirms exactly the requested choice. */
export function confirmsChoice(body: unknown, shared: boolean): boolean {
  const r = receipt.safeParse(body);
  return r.success && r.data.shared === shared;
}
type Dossier = { status: string; artisan_id?: string | null; client_id?: string | null };
/** Mirror of the server rule, used only to decide whether the block is offered at all. */
export function offerPhotosOpen(dossier: Dossier, viewer: { id: string | null; role: string; live: boolean }): boolean {
  return viewer.live && viewer.role === "client" && !!viewer.id && dossier.client_id === viewer.id && dossier.status === "requested" && !dossier.artisan_id;
}
type Doc = { id: string; owner_id?: string; mime_type: string };
/** The requester's own images of the dossier: the only documents the server accepts. */
export function shareablePhotos<T extends Doc>(documents: readonly T[], viewerId: string | null): T[] {
  return documents.filter((d) => !!viewerId && d.owner_id === viewerId && (OFFER_PHOTO_TYPES as readonly string[]).includes(d.mime_type));
}
export const OFFER_PHOTOS_COPY = {
  title: "Photos visibles par les artisans avant attribution",
  intro: "Vos photos restent privées par défaut. Vous choisissez celles que les artisans éligibles à votre demande peuvent voir avant de l’accepter.",
  loading: "Lecture du partage des photos…",
  loadFailed: "Le partage des photos n’a pas pu être lu.",
  shared: "Visible par les artisans éligibles",
  private: "Privée",
  share: "Partager avec les artisans…",
  shareConfirm: "Partager cette photo ? Les artisans éligibles à votre demande pourront la voir avant attribution. Choisissez uniquement une image sans personne, adresse ou document identifiable.",
  shareDo: "Partager la photo",
  withdraw: "Retirer du partage…",
  withdrawConfirm: "Retirer cette photo du partage ? Les artisans éligibles ne pourront plus la voir. Elle reste dans votre dossier privé : le document n’est pas supprimé.",
  withdrawDo: "Retirer la photo du partage",
  sharedDone: "Photo partagée avec les artisans éligibles.",
  withdrawnDone: "Photo retirée du partage. Elle reste dans votre dossier privé.",
  keptNote: "Retirer une photo du partage ne la supprime pas du dossier : après attribution, l’artisan chargé de l’intervention accède aux pièces du dossier. Tant qu’aucun artisan n’est attribué, vous pouvez aussi supprimer définitivement une photo.",
  remove: "Supprimer la photo…",
  removeConfirm: "Supprimer définitivement cette photo ? Elle sera retirée du partage et effacée de votre dossier ; cette action est irréversible.",
  removeDo: "Supprimer définitivement",
  removedDone: "Photo supprimée définitivement du dossier.",
} as const;
/** Honest reason of a refused choice, from the HTTP status of the command. */
export function offerPhotoError(status: number, shared: boolean): string {
  if (status === 409) return "La demande n’est plus ouverte aux offres : le partage des photos ne peut plus être modifié. Actualisez le dossier.";
  if (status === 422 && shared) return `Vous pouvez partager ${OFFER_PHOTO_LIMIT} photos au plus. Retirez-en une avant d’en partager une autre.`;
  if (status === 401 || status === 403 || status === 404) return "Ce choix n’est pas disponible pour cette photo.";
  if (status === 429) return "Trop de tentatives. Patientez une minute puis réessayez.";
  return "Le choix n’a pas pu être vérifié. Vérifiez l’état affiché avant de réessayer.";
}
