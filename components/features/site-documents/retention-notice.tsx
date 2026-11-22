"use client";
// SYS-06 — retention policy of documents, as PUBLISHED by the operator (public operator profile, field
// `privacy_retention`). The durations are the operator's data: none is invented or applied here.
//   · published text  → shown verbatim, with its source ;
//   · nothing published → administrators are told that the policy is not defined and that no
//     automatic deletion or archiving runs; other users are told that no duration is published.
// A failed read says so (retry) and never falls back to « not defined ».
import { useCallback, useEffect, useState } from "react";

type State = { phase: "loading" | "ready" | "error"; text: string | null };
export function RetentionNotice({ audience, demo = false }: { audience: "admin" | "user"; demo?: boolean }) {
  const [state, setState] = useState<State>({ phase: demo ? "ready" : "loading", text: null });
  const load = useCallback(async (signal?: AbortSignal) => {
    if (demo) return;
    try {
      const response = await fetch("/api/public/operator-profile", { cache: "no-store", signal });
      const body = (await response.json().catch(() => null)) as { published?: { privacy_retention?: unknown } | null } | null;
      if (!response.ok || !body || !("published" in body)) throw new Error("unavailable");
      const text = typeof body.published?.privacy_retention === "string" ? body.published.privacy_retention.trim() : "";
      setState({ phase: "ready", text: text || null });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setState({ phase: "error", text: null });
    }
  }, [demo]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  if (state.phase === "loading") return null;
  return (
    <aside className="inline-note" data-retention-policy={state.phase === "error" ? "error" : state.text ? "published" : "undefined"} aria-label="Conservation des documents" style={{ display: "grid", gap: 4 }}>
      <strong>Conservation des documents</strong>
      {state.phase === "error" ? (
        <span role="alert">
          La politique de conservation publiée n’a pas pu être lue.{" "}
          <button type="button" className="text-button" onClick={() => void load()}>Réessayer</button>
        </span>
      ) : state.text ? (
        <>
          <span>Durées de conservation publiées par l’exploitant :</span>
          <span style={{ whiteSpace: "pre-line" }} data-retention-policy-text="">{state.text}</span>
          {audience === "admin" && <span>Aucune suppression automatique n’est exécutée par l’application : l’application de ces durées reste une opération de l’exploitant.</span>}
        </>
      ) : audience === "admin" ? (
        <span data-retention-policy-undefined="">
          Politique de conservation : <strong>non définie par l’exploitant</strong>. Aucune durée n’est donc appliquée : aucun document n’est supprimé ni archivé automatiquement. Renseignez « Durées de conservation » dans Paramètres &gt; Profil public, puis publiez-le.
        </span>
      ) : (
        <span data-retention-policy-undefined="">L’exploitant n’a pas encore publié de durées de conservation. Aucun de vos documents n’est supprimé automatiquement.</span>
      )}
    </aside>
  );
}
