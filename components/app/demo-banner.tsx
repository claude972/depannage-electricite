"use client";

import type { Session } from "./session-types";
import { ROLE_NAMES } from "./format";
import { ConfirmAction } from "./ui";
import styles from "./demo-banner.module.css";

export function DemoBanner({ session, inert = false }: { session: Session; inert?: boolean }) {
  return (
    <div className={styles.banner} aria-label="Mode démonstration" inert={inert}>
      <details className={styles.details}>
        <summary><strong>Démonstration</strong><span>Données fictives</span></summary>
        <div className={styles.explanation}>
          <p>Aucun artisan n’est contacté et aucun débit n’est effectué. Les modifications restent dans cette démonstration.</p>
          <ConfirmAction label="Réinitialiser la démonstration" message="Les modifications locales de démonstration seront remplacées par les exemples initiaux." confirmLabel="Réinitialiser" busy={session.busy} onConfirm={async () => session.resetDemo()} />
        </div>
      </details>
      <label>
        <span className="sr-only">Rôle exploré</span>
        <select aria-label="Rôle exploré" value={session.role} onChange={(event) => session.setDemoRole(event.target.value as Session["role"])}>
          {Object.entries(ROLE_NAMES).map(([role, label]) => <option key={role} value={role}>{role === "admin" ? "Super Admin" : label}</option>)}
        </select>
      </label>
    </div>
  );
}
