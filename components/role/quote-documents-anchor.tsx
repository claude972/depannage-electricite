"use client";
// Point d’ancrage commun des documents de devis (ADV-DOCUMENTS-001) : panneau artisan, client et
// entreprise. État de capacité, client injecté et démo isolée viennent de la session ; l’autorité
// est fournie par la coque appelante (vrai pour client/artisan, autorité entreprise fail-closed).
import { QuoteDocumentsPanel } from "../features/quote-documents";
import { CONTRACT_MESSAGES } from "../app/api";
import type { Session } from "../app/session-types";
import type { QuoteDocumentsTarget } from "../../lib/features/quote-documents/types";
import { quoteDocumentsDemo } from "../../lib/features/quote-documents/demo";
import { leafScope } from "./anchors";

export function QuoteDocumentsAnchor({
  session,
  variant,
  target,
  authority,
  organizationId,
  siteId,
}: {
  session: Session;
  variant: "artisan" | "client" | "enterprise";
  target: QuoteDocumentsTarget;
  authority: { canWrite: boolean; reason?: string };
  organizationId?: string;
  siteId?: string;
}) {
  const state = session.capabilities.quoteDocuments;
  return (
    <QuoteDocumentsPanel
      variant={variant}
      target={target}
      state={state}
      unavailableMessage={state === "available" ? undefined : CONTRACT_MESSAGES[state]}
      scope={leafScope(session.profileId, session.role, authority, { organizationId, siteId })}
      client={session.features.quoteDocuments}
      demo={session.mode === "demo" ? { overview: quoteDocumentsDemo(session.role) } : undefined}
      onNavigate={(view) => {
        if (view === "artisan-profile") session.go("profile");
      }}
    />
  );
}
