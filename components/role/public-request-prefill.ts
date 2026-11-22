import type { RequestValues } from "../app/types";

export type RequestPrefill = Partial<Pick<RequestValues, "category" | "description" | "urgency">>;
const PREFILLS: ReadonlyMap<string, RequestPrefill> = new Map([
  ["urgent", { urgency: "urgent" }],
  ["scheduled", { urgency: "scheduled" }],
  ["installation-prise", { category: "socket", description: "Ajouter une prise" }],
  ["installation-luminaire", { category: "lighting", description: "Installer un luminaire" }],
]);

export function requestPrefill(param: string): RequestPrefill | undefined {
  return PREFILLS.get(param);
}
