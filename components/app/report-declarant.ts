// Historical intervention report: the name stored with the report is typed by the declaring
// artisan. It is a declaration, never the client's signature nor an acknowledgement of receipt
// (E59/E60 acknowledgement contract not published). Shared wording for every role view.
export function reportDeclarant(name: string | null | undefined, when?: string): string {
  const who = (name ?? "").trim();
  const head = who ? `Déclaré par l’artisan : ${who}` : "Nom du déclarant non renseigné";
  return `${head}${when ? ` · ${when}` : ""}. Ce compte rendu n’est ni une signature du client ni un accusé de réception.`;
}
