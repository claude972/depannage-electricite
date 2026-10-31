"use client";
// Point d’ancrage commun des notifications (ADV-PLANNING-NOTIFICATIONS-001) pour les quatre coques :
// cloche d’en-tête et vue « notifications ». Tout vient de la session (état de capacité, compteur
// serveur, client injecté, démo isolée) ; rien n’est recalculé ni simulé ici.
import { NotificationBell } from "../features/notifications/notification-bell";
import { NotificationCenter } from "../features/notifications/notification-center";
import { CONTRACT_MESSAGES } from "../app/api";
import { PageTitle } from "../app/ui";
import type { Session } from "../app/session-types";
import { demoNotificationPage, demoPreferences } from "../../lib/features/notifications/demo";
import { leafScope } from "./anchors";

export function HeaderBell({ session }: { session: Session }) {
  return (
    <NotificationBell
      state={session.capabilities.notifications}
      unreadCount={session.unreadNotifications}
      onOpen={() => session.go("notifications")}
    />
  );
}

export function NotificationsPage({
  session,
  organizationId,
  siteId,
  withTitle = true,
}: {
  session: Session;
  organizationId?: string;
  siteId?: string;
  /** Les coques qui affichent déjà le titre de vue dans leur en-tête passent false. */
  withTitle?: boolean;
}) {
  const state = session.capabilities.notifications;
  const role = session.role;
  if (!role) return null;
  return (
    <>
      {withTitle && (
        <PageTitle
          title="Notifications"
          subtitle="Événements de vos dossiers, enregistrés par la plateforme ; aucun envoi externe."
        />
      )}
      <NotificationCenter
        state={state}
        unavailableMessage={state === "available" ? "" : CONTRACT_MESSAGES[state]}
        scope={leafScope(session.profileId, role, { canWrite: true }, { organizationId, siteId })}
        client={session.features.notifications}
        demo={
          session.mode === "demo"
            ? { page: demoNotificationPage({}), preferences: demoPreferences() }
            : undefined
        }
        onNavigate={(view, param) => {
          if (view === "intervention" && param) session.openIntervention(param);
        }}
      />
    </>
  );
}
