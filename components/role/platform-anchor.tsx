"use client";
// Point d’ancrage du back-office plateforme (ADV-PLATFORM-FINANCE-001) : les trois vues du lot,
// ouvertes uniquement par la réponse serveur `platformAccess` (fail-closed). Sans réponse ou sans
// droit, l’écran dit honnêtement que l’accès n’est pas vérifié ; rien n’est chargé ni simulé.
import { PlatformFinanceView, PlatformModerationView, PlatformOperatorsView } from "../features/platform-operations";
import { CONTRACT_MESSAGES } from "../app/api";
import { operatorViewAllowed, platformViewAllowed, type OperatorView } from "../app/features";
import { SupportCenter } from "./support-tickets";
import { PageTitle, Unavailable } from "../app/ui";
import type { Session } from "../app/session-types";
import { PLATFORM_DEMO } from "../../lib/features/platform-operations/demo";
import { PLATFORM_ENTRIES, platformAuthority, platformPageRetry } from "./anchors";
import { FeatureUnavailable } from "./feature-unavailable";

export const PLATFORM_TITLES: Record<OperatorView, { title: string; subtitle: string }> = {
  "platform-operators": { title: "Opérateurs de plateforme", subtitle: "Habilitations, super-administrateurs et journal" },
  "platform-finance": { title: "Finance plateforme", subtitle: "Rapprochement, ledger, factures, remboursements et litiges" },
  "platform-moderation": { title: "Modération des avis", subtitle: "Avis masqués, contestations et décisions" },
  "support-queue": { title: "File d’assistance", subtitle: "Demandes de tous les comptes ; réponse et statut selon vos habilitations" },
};

export function PlatformPage({
  session,
  view,
  withTitle = true,
}: {
  session: Session;
  view: OperatorView;
  withTitle?: boolean;
}) {
  const state = session.capabilities.platformOperations;
  const access = session.platformAccess;
  const heading = PLATFORM_TITLES[view];
  const title = withTitle ? <PageTitle title={heading.title} subtitle={heading.subtitle} /> : null;
  if (view === "support-queue") {
    // A5: the assistance queue reuses the existing support leaf in "all" mode. Opened only by the
    // server capability `support` (support_read or super admin); per-ticket rights come from the
    // server with each ticket. No data is loaded without that reply.
    if (!operatorViewAllowed(access, view))
      return (
        <>
          {title}
          <Unavailable
            title="Accès non vérifié"
            reason={access ? "Vos droits d’assistance ne couvrent pas la file globale." : "Vos droits d’opérateur n’ont pas encore été vérifiés par la plateforme. Aucune donnée n’est chargée."}
            blocker={`support-queue:${state}`}
            onRetry={platformPageRetry(state, access) ? () => session.reprobeFeature("platformOperations") : undefined}
          />
        </>
      );
    return (
      <>
        {title}
        <SupportCenter session={session} interventions={[]} backView="support-queue" queue="all" />
      </>
    );
  }
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
    // Scoped finance/moderation operators may read these rows without access to the admin directory.
    onNavigate: session.role === "admin" && access?.super_admin
      ? (target: string, param?: string) => {
          if (target === "intervention" && param) session.openIntervention(param);
          else if (target === "client" && param) session.go("admin-clients", param);
          else if (target === "artisan" && param) session.go("admin-artisan", param);
        }
      : undefined,
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

export const isPlatformView = (view: string): view is OperatorView =>
  PLATFORM_ENTRIES.some((e) => e.view === view);
