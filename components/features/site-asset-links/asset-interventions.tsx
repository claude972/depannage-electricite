"use client";
// ENT-07: the interventions linked to ONE equipment (or zone), listed on its card: reference,
// status and date. Read on demand (when the block is opened) from the same site-scoped route as
// the dossier side; nothing is inferred: a dossier appears only through an explicit link.
import { useRef, useState } from "react";
import { category, date, shortId, STATUS } from "../../app/format";
import type { Status } from "../../app/types";
import { ASSET_LINKS_COPY as COPY, dossiersOfAsset, parseAssetLinksPage, readAssetLinks, type AlContext, type AssetKind, type LinkRow } from "./asset-links-model";

type View = { phase: "idle" | "loading" | "ready" | "error"; records: LinkRow[]; cursor: string | null; error: string; loadingMore: boolean };
const INITIAL: View = { phase: "idle", records: [], cursor: null, error: "", loadingMore: false };

export type AssetInterventionsProps = {
  siteId: string;
  kind: AssetKind;
  assetId: string;
  /** Identity fence (uid + generation): the answer of another session is dropped. */
  context: AlContext;
  onOpenDossier?: (interventionId: string) => void;
  /** Tests only. */
  fetcher?: typeof fetch;
  initial?: View;
};

export function AssetInterventions(props: AssetInterventionsProps) {
  return <Body key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.siteId}|${props.assetId}`} {...props} />;
}

function Body({ siteId, kind, assetId, context, onOpenDossier, fetcher, initial }: AssetInterventionsProps) {
  const [view, setView] = useState<View>(initial ?? INITIAL);
  const seq = useRef(0);
  const who = useRef({ uid: context.userId(), gen: context.generation() });
  const load = async (cursor: string | null) => {
    const my = ++seq.current;
    setView((v) => (cursor ? { ...v, loadingMore: true, error: "" } : { ...INITIAL, phase: "loading" }));
    const r = await readAssetLinks(fetcher ?? ((...a) => fetch(...a)), siteId, kind, assetId, cursor);
    if (my !== seq.current || context.userId() !== who.current.uid || context.generation() !== who.current.gen) return;
    const page = r.status === 200 ? parseAssetLinksPage(r.body, siteId, kind, assetId, cursor === null) : null;
    if (!page) {
      const error = r.status === 401 ? COPY.session : r.status === 403 || r.status === 404 ? COPY.forbidden : COPY.failed;
      return setView((v) => (cursor ? { ...v, loadingMore: false, error } : { ...INITIAL, phase: "error", error }));
    }
    setView((v) => ({ phase: "ready", records: cursor ? [...v.records, ...page.records] : page.records, cursor: page.page.next_cursor, error: "", loadingMore: false }));
  };
  const rows = dossiersOfAsset(view.records);
  return (
    <details
      data-asset-interventions={assetId}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && view.phase === "idle") void load(null);
      }}
    >
      <summary>{COPY.summary}</summary>
      {view.phase === "loading" && <p role="status">{COPY.loading}</p>}
      {view.phase === "error" && (
        <p role="alert">
          {view.error}{" "}
          <button type="button" className="button outline" onClick={() => void load(null)}>
            Réessayer
          </button>
        </p>
      )}
      {view.phase === "ready" && rows.length === 0 && <p>{COPY.empty}</p>}
      {view.phase === "ready" && rows.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {rows.map((d) => (
            <li key={d.interventionId} data-asset-dossier={d.interventionId} data-asset-link-active={d.active ? "true" : "false"}>
              <strong>{shortId(d.interventionId)}</strong> · {category(d.category).label} · {STATUS[d.status as Status] ?? d.status} · demande du {date(d.createdAt)} · liée le {date(d.linkedAt)}
              {!d.active && d.detachedAt ? ` · ${COPY.detached} le ${date(d.detachedAt)}` : ""}
              {onOpenDossier && (
                <>
                  {" "}
                  <button type="button" className="text-button" onClick={() => onOpenDossier(d.interventionId)}>
                    Ouvrir le dossier
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.phase === "ready" && view.error && <p role="alert">{view.error}</p>}
      {view.phase === "ready" && view.cursor && (
        <button type="button" className="button outline" disabled={view.loadingMore} onClick={() => void load(view.cursor)}>
          {view.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </details>
  );
}
