"use client";
// Point d’ancrage commun des documents de devis (ADV-DOCUMENTS-001) : panneau artisan, client et
// entreprise. État de capacité, client injecté et démo isolée viennent de la session ; l’autorité
// est fournie par la coque appelante (vrai pour client/artisan, autorité entreprise fail-closed).
// DEMO-QUOTE-DOCS (claim, Claude UI): la démo est construite à partir du dossier/devis réellement affiché.
import { useMemo } from "react";
import { QuoteDocumentsPanel } from "../features/quote-documents";
import { CONTRACT_MESSAGES } from "../app/api";
import { useDossierPoll } from "../app/dossier-poll";
import { FeatureUnavailable, useProbeWhenUnknown } from "./feature-unavailable";
import type { Session } from "../app/session-types";
import type { Workspace } from "../app/types";
import { quoteRef } from "../app/format";
import { Empty } from "../app/ui";
import type { QuoteDocumentsOverview, QuoteDocumentsTarget } from "../../lib/features/quote-documents/types";
import { quoteDocumentsDemoFor, type DemoDossierSource } from "../../lib/features/quote-documents/demo";
import { leafScope } from "./anchors";

/** The demo dossier ACTUALLY shown for `target` (quote page ⇒ that quote only; dossier ⇒ its
 *  quotes). null when it cannot be resolved: never another dossier's data. */
export function demoQuoteDocumentsSource(data: Workspace | null | undefined, target: QuoteDocumentsTarget): DemoDossierSource | null {
  if (!data) return null;
  const quote = "quoteId" in target ? data.quotes.find((q) => q.id === target.quoteId) : undefined;
  if ("quoteId" in target && !quote) return null;
  const interventionId = quote ? quote.intervention_id : "interventionId" in target ? target.interventionId : "";
  const intervention = data.interventions.find((i) => i.id === interventionId);
  if (!intervention) return null;
  const quotes = quote ? [quote] : data.quotes.filter((q) => q.intervention_id === intervention.id);
  return {
    intervention: { id: intervention.id, status: intervention.status, artisan_id: intervention.artisan_id ?? null, site_id: intervention.site_id ?? null },
    quotes: quotes.map((q) => ({
      id: q.id, reference: quoteRef(q.id), status: q.status, created_at: q.created_at, accepted_at: q.accepted_at ?? null,
      lines: q.lines, subtotal_cents: q.subtotal_cents, tax_rate: q.tax_rate, tax_cents: q.tax_cents, total_cents: q.total_cents,
    })),
  };
}
/** Demo overview, ONLY in demo mode (live never receives demo data): `undefined` = live,
 *  "empty" = the shown dossier cannot be resolved, otherwise the panel's `demo` prop. */
export function demoQuoteDocuments(session: Pick<Session, "mode" | "role" | "data">, target: QuoteDocumentsTarget): { overview: QuoteDocumentsOverview } | "empty" | undefined {
  if (session.mode !== "demo") return undefined;
  const overview = quoteDocumentsDemoFor(session.role, demoQuoteDocumentsSource(session.data, target));
  return overview ? { overview } : "empty";
}

export function QuoteDocumentsAnchor({
  session,
  variant,
  target,
  authority,
  organizationId,
  siteId,
  poll = false,
}: {
  session: Session;
  variant: "artisan" | "client" | "enterprise";
  target: QuoteDocumentsTarget;
  authority: { canWrite: boolean; reason?: string };
  organizationId?: string;
  siteId?: string;
  /** SYS-05: also re-read on the dossier polling tick (an open dossier whose other party acts). */
  poll?: boolean;
}) {
  const state = session.capabilities.quoteDocuments;
  const targetKey = "quoteId" in target ? `q:${target.quoteId}` : `i:${target.interventionId}`;
  // Memoized: the panel reloads its demo overview only when the shown dossier really changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const demo = useMemo(() => demoQuoteDocuments(session, target), [session.mode, session.role, session.data, targetKey]);
  // SYS-05: a workspace refresh (realtime event, « Actualiser ») re-reads the panel silently; with
  // `poll`, so does the dossier polling tick (amendments and terms are not pushed live).
  const tick = useDossierPoll(poll && session.mode === "live" && state === "available");
  useProbeWhenUnknown(session, "quoteDocuments", "quoteId" in target ? { quoteId: target.quoteId } : { interventionId: target.interventionId });
  if (state === "unavailable")
    return (
      <FeatureUnavailable
        session={session}
        featureKey="quoteDocuments"
        title="Documents du devis momentanément indisponibles"
        hint={"quoteId" in target ? { quoteId: target.quoteId } : { interventionId: target.interventionId }}
      />
    );
  if (demo === "empty")
    return (
      <div data-quote-documents-demo="empty">
        <Empty icon="document" title="Aucun document de devis à afficher">
          Ce dossier de démonstration n’a pas de devis correspondant : aucune donnée d’un autre dossier n’est affichée.
        </Empty>
      </div>
    );
  return (
    <QuoteDocumentsPanel
      variant={variant}
      target={target}
      state={state}
      unavailableMessage={state === "available" ? undefined : CONTRACT_MESSAGES[state]}
      scope={leafScope(session.profileId, session.role, authority, { organizationId, siteId })}
      client={session.features.quoteDocuments}
      demo={demo}
      refreshKey={`${session.refreshedAt}|${tick}`}
      onNavigate={(view) => {
        if (view === "artisan-profile") session.go("profile");
      }}
    />
  );
}
