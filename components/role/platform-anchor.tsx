"use client";
// Point d’ancrage du back-office plateforme (ADV-PLATFORM-FINANCE-001) : les trois vues du lot,
// ouvertes uniquement par la réponse serveur `platformAccess` (fail-closed). Sans réponse ou sans
// droit, l’écran dit honnêtement que l’accès n’est pas vérifié ; rien n’est chargé ni simulé.
import { PlatformFinanceView, PlatformModerationView, PlatformOperatorsView } from "../features/platform-operations";
import { CONTRACT_MESSAGES } from "../app/api";
import { platformViewAllowed, type PlatformView } from "../app/features";
import { PageTitle, Unavailable } from "../app/ui";
import type { Session } from "../app/session-types";
import { PLATFORM_DEMO } from "../../lib/features/platform-operations/demo";
import { PLATFORM_ENTRIES, platformAuthority, platformPageRetry } from "./anchors";
import { FeatureUnavailable } from "./feature-unavailable";

export const PLATFORM_TITLES: Record<PlatformView, { title: string; subtitle: string }> = {
  "platform-operators": { title: "Opérateurs de plateforme", subtitle: "Habilitations, super-administrateurs et journal" },
  "platform-finance": { title: "Finance plateforme", subtitle: "Rapprochement, ledger, factures, remboursements et litiges" },
  "platform-moderation": { title: "Modération des avis", subtitle: "Avis masqués, contestations et décisions" },
};

export function PlatformPage({
  session,
  view,
  withTitle = true,
}: {
  session: Session;
  view: PlatformView;
  withTitle?: boolean;
}) {
  const state = session.capabilities.platformOperations;
  const access = session.platformAccess;
  const heading = PLATFORM_TITLES[view];
  const title = withTitle ? <PageTitle title={heading.title} subtitle={heading.subtitle} /> : null;
  if (state === "unavailable" && platformViewAllowed(access, view)) {
    // Access validated by /me, contract transiently down (503): bounded re-probe, no data loaded.
    return (
      <>
        {title}
        <FeatureUnavailable session={session} featureKey="platformOperations" title={`${heading.title} — service momentanément indisponible`} />
      </>
    );
  }
  if (!platformViewAllowed(access, view)) {
    // Aucune réponse serveur, service indisponible ou droit absent : état explicite, aucun appel.
    const reason =
      state !== "available" && state !== "unknown"
        ? CONTRACT_MESSAGES[state]
        : access
          ? "Vos droits d’opérateur ne couvrent pas cette section."
          : "Vos droits d’opérateur n’ont pas encore été vérifiés par la plateforme. Aucune donnée n’est chargée.";
    return (
      <>
        {title}
        <Unavailable
          title="Accès non vérifié"
          reason={reason}
          state={state === "available" ? undefined : state}
          blocker={`platform:${view}:${state}`}
          onRetry={platformPageRetry(state, access) ? () => session.reprobeFeature("platformOperations") : undefined}
        />
      </>
    );
  }
  const common = {
    state,
    unavailableMessage: state === "available" ? "" : CONTRACT_MESSAGES[state],
    scope: { userId: session.profileId, role: session.role, authority: platformAuthority(access, view) },
    client: session.features.platform,
    demo: session.mode === "demo" ? PLATFORM_DEMO : undefined,
    onNavigate: (target: string, param?: string) => {
      if (target === "intervention" && param) session.openIntervention(param);
    },
  };
  return (
    <>
      {title}
      {view === "platform-operators" ? (
        <PlatformOperatorsView {...common} />
      ) : view === "platform-finance" ? (
        <PlatformFinanceView {...common} />
      ) : (
        <PlatformModerationView {...common} />
      )}
    </>
  );
}

export const isPlatformView = (view: string): view is PlatformView =>
  PLATFORM_ENTRIES.some((e) => e.view === view);
