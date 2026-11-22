"use client";
// Read-only dossier from a point read (FASTSPLIT-DETAIL-CONSUMER-001): a dossier that exists and is
// readable under RLS but lies outside the 100 most recent loaded in the workspace. Built only from
// global primitives so it renders in every role space (themed or not). Nothing is invented: linked
// items are shown as returned (« non accessible » when hidden, « indisponible » on error, partial
// lists flagged). Actions stay in the dossier views once the dossier is in the recent list.
import { Loader, PageTitle, Tag, Unavailable } from "../app/ui";
import { CATEGORIES, STATUS, date, dateTime, money } from "../app/format";
import { BookingLocationRows } from "./booking-location-rows";
import { chronologicalMessages } from "../app/detail-read-client";
import type { DetailRead } from "../../lib/features/workspace/detail-read";

type Props = {
  detail: DetailRead;
  backLabel: string;
  onBack: () => void;
  /** Enterprise: the dossier belongs to a site other than the active one. */
  outsideActivePerimeter?: boolean;
  bookingLocationContext?: string;
};

const QUOTE_STATUS: Record<string, string> = { sent: "Envoyé", accepted: "Accepté", rejected: "Refusé" };
const PAYMENT_STATUS: Record<string, string> = { pending: "En attente", paid: "Réglé", failed: "Échoué" };

function Partial({ limited, incomplete }: { limited?: boolean; incomplete?: boolean }) {
  if (!limited && !incomplete) return null;
  return (
    <p className="form-note">
      {incomplete ? "Historique incomplet : certains éléments n'ont pas pu être chargés." : "Liste partielle : seuls les éléments les plus récents sont affichés."}
    </p>
  );
}
/** Empty list: a global « aucun » only when the list is complete; otherwise say it covers the loaded part. */
function EmptyList({ none, noneLoaded, partial }: { none: string; noneLoaded: string; partial: boolean }) {
  return <p className="form-note">{partial ? `${noneLoaded} Historique incomplet.` : none}</p>;
}
function Unreadable() {
  return (
    <p className="form-note" role="status">
      Indisponible pour le moment. Réessayez dans un instant.
    </p>
  );
}

export function DetailReadView({ detail, backLabel, onBack, outsideActivePerimeter, bookingLocationContext }: Props) {
  const i = detail.intervention;
  const cat = CATEGORIES.find((c) => c.id === i.category)?.label ?? "Intervention";
  const messages = chronologicalMessages(detail);
  return (
    <>
      <PageTitle back={{ label: backLabel, onClick: onBack }} title={cat} subtitle={`Créé le ${date(i.created_at)} · ${i.city}`} />
      <section className="panel" aria-labelledby="detail-read-note">
        <p id="detail-read-note" className="form-note">
          Dossier plus ancien, affiché en lecture seule. Les actions restent disponibles depuis vos dossiers récents.
        </p>
        {outsideActivePerimeter && (
          <p className="form-note" role="status">
            Ce dossier appartient à un autre site que le site actif. Changez de site pour agir dessus.
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="detail-read-summary">
        <h2 id="detail-read-summary">Intervention</h2>
        <p>
          <Tag tone="neutral">{STATUS[i.status]}</Tag>
        </p>
        <p>{i.description}</p>
        <dl>
          <div>
            <dt>Adresse</dt>
            <dd>
              {i.address}, {i.postal_code} {i.city}
            </dd>
          </div>
          {bookingLocationContext && <BookingLocationRows key={`${bookingLocationContext}|${i.id}|${i.updated_at}|${i.artisan_id}`} interventionId={i.id} />}
          <div>
            <dt>Estimation initiale (indicative)</dt>
            <dd>
              {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
            </dd>
          </div>
          {detail.site.status === "ok" && (
            <div>
              <dt>Site</dt>
              <dd>{detail.site.value.name}</dd>
            </div>
          )}
          {detail.site.status === "hidden" && (
            <div>
              <dt>Site</dt>
              <dd>Non accessible avec vos droits</dd>
            </div>
          )}
          {detail.site.status === "error" && (
            <div>
              <dt>Site</dt>
              <dd>Indisponible pour le moment</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="panel" aria-labelledby="detail-read-quotes">
        <h2 id="detail-read-quotes">Devis</h2>
        {detail.quotes.status === "error" ? (
          <Unreadable />
        ) : detail.quotes.items.length === 0 ? (
          <EmptyList none="Aucun devis pour ce dossier." noneLoaded="Aucun devis dans la partie chargée." partial={detail.quotes.limited} />
        ) : (
          <ul>
            {detail.quotes.items.map((q) => (
              <li key={q.id}>
                {money(q.total_cents)} — {QUOTE_STATUS[q.status] ?? q.status} · {date(q.created_at)}
              </li>
            ))}
          </ul>
        )}
        {detail.quotes.status === "ok" && detail.quotes.items.length > 0 && <Partial limited={detail.quotes.limited} />}
      </section>

      <section className="panel" aria-labelledby="detail-read-payments">
        <h2 id="detail-read-payments">Paiements</h2>
        {detail.payments.status === "error" ? (
          <Unreadable />
        ) : detail.payments.items.length === 0 ? (
          <EmptyList none="Aucun paiement enregistré." noneLoaded="Aucun paiement dans la partie chargée." partial={detail.payments.limited || detail.payments.incomplete} />
        ) : (
          <ul>
            {detail.payments.items.map((p) => (
              <li key={p.id}>
                {money(p.total_cents)} — {PAYMENT_STATUS[p.status] ?? p.status} · {date(p.created_at)}
              </li>
            ))}
          </ul>
        )}
        {detail.payments.status === "ok" && detail.payments.items.length > 0 && <Partial limited={detail.payments.limited} incomplete={detail.payments.incomplete} />}
      </section>

      <section className="panel" aria-labelledby="detail-read-messages">
        <h2 id="detail-read-messages">Échanges</h2>
        {detail.messages.status === "error" ? (
          <Unreadable />
        ) : messages.length === 0 ? (
          <EmptyList none="Aucun message." noneLoaded="Aucun message dans la partie chargée." partial={detail.messages.limited} />
        ) : (
          <ul>
            {messages.map((m) => (
              <li key={m.id}>
                <small>{dateTime(m.created_at)}</small> — {m.body}
              </li>
            ))}
          </ul>
        )}
        {detail.messages.status === "ok" && detail.messages.items.length > 0 && <Partial limited={detail.messages.limited} />}
      </section>

      <section className="panel" aria-labelledby="detail-read-documents">
        <h2 id="detail-read-documents">Documents</h2>
        {detail.documents.status === "error" ? (
          <Unreadable />
        ) : detail.documents.items.length === 0 ? (
          <EmptyList none="Aucun document." noneLoaded="Aucun document dans la partie chargée." partial={detail.documents.limited} />
        ) : (
          <ul>
            {detail.documents.items.map((d) => (
              <li key={d.id}>
                {d.name} · {date(d.created_at)}
              </li>
            ))}
          </ul>
        )}
        {detail.documents.status === "ok" && detail.documents.items.length > 0 && <Partial limited={detail.documents.limited} />}
      </section>
    </>
  );
}

/**
 * Point-read states shared by the three detail views: read-only dossier, loading, or error with a
 * retry that honours Retry-After. Returns null for every other decision (the view keeps its own).
 */
export function PointReadState({
  presence,
  backLabel,
  onBack,
  outsideActivePerimeter,
  bookingLocationContext,
}: {
  presence: { decision: string; detail?: DetailRead; retry: () => void; retryInS?: number };
  backLabel: string;
  onBack: () => void;
  outsideActivePerimeter?: (detail: DetailRead) => boolean;
  bookingLocationContext?: string;
}) {
  if (presence.decision === "detail" && presence.detail)
    return (
      <DetailReadView
        detail={presence.detail}
        backLabel={backLabel}
        onBack={onBack}
        outsideActivePerimeter={outsideActivePerimeter?.(presence.detail)}
        bookingLocationContext={bookingLocationContext}
      />
    );
  if (presence.decision === "detail_loading") return <Loader label="Ouverture du dossier…" />;
  if (presence.decision === "detail_error") {
    const wait = presence.retryInS ?? 0;
    return (
      <Unavailable
        title="Dossier momentanément indisponible"
        reason={
          wait > 0
            ? `Le dossier n’a pas pu être lu. Nouvel essai possible dans ${wait} s.`
            : "Le dossier n’a pas pu être lu. Vos données n’ont pas été modifiées : réessayez."
        }
        blocker="detail-read:error"
        onRetry={wait > 0 ? undefined : presence.retry}
      />
    );
  }
  return null;
}
