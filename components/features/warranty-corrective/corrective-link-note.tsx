"use client";
// ADM-10 (requester side): names the corrective dossier an administrator linked to a warranty case.
// One GET /api/warranty/<case>/corrective per case and revision; the server only returns a link
// the reader may access (RLS). Silent while loading, on refusal, on failure and without a link:
// nothing is promised, no price and no payment is implied.
import { useEffect, useRef, useState } from "react";
import { category, shortId, STATUS } from "../../app/format";
import type { Status } from "../../app/types";
import { createCorrectiveApi, parseCorrective, type Context, type Dossier } from "./model";

export const correctiveLinkText = (d: Dossier) =>
  `Dossier correctif rattaché : ${shortId(d.id)} · ${category(d.category).label} · ${STATUS[d.status as Status] ?? d.status}. Vous le retrouvez dans vos demandes.`;

export function CorrectiveLinkNote({ caseId, revision, context, fetcher }: { caseId: string; /** Case revision (updated_at): a decision re-reads the link. */ revision?: string; context: Context; fetcher?: typeof fetch }) {
  const [link, setLink] = useState<{ key: string; value: Dossier } | null>(null);
  const key = `${context.userId() ?? "-"}|${context.generation()}|${caseId}|${revision ?? ""}`;
  const latest = useRef({ fetcher });
  latest.current = { fetcher };
  useEffect(() => {
    let active = true;
    void createCorrectiveApi(latest.current.fetcher).read(caseId).then((r) => {
      const value = r.status === 200 ? parseCorrective(r.body)?.link : null;
      if (active && value) setLink({ key, value });
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [caseId, key]);
  if (!link || link.key !== key) return null;
  return (
    <p data-warranty-corrective-link={link.value.id}>
      <strong>{correctiveLinkText(link.value)}</strong>
    </p>
  );
}
