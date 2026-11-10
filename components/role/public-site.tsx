"use client";
// Public site (mode "public"): landing, request draft, account entry, help and the honest
// informational pages. Presentational only: every action goes through `session`.
// Visual references (addendum « pages publiques »): M11/M51 (home), M46/M70/M42 (help), M38
// (pricing), M60 (join), V8-C03 (about), V8-C05 (privacy), M63 (legal), M49 (auth). Every number,
// promise, team or contact of those mockups is an example and is never reproduced here.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicSession } from "../app/session-types";
import type { Category, Role, View } from "../app/types";
import { Alerts, PageTitle, Unavailable } from "../app/ui";
import { AuthForm, RequestForm } from "../app/forms";
import { Icon } from "../app/icons";
import { InstallPanel } from "../app/install-panel";
import { CATEGORIES, category, money } from "../app/format";
import { PublicHome } from "./public-home";
import { requestPrefill } from "./public-request-prefill";
import { PublicChrome, type HomeHandlers } from "./public-chrome";
import formStyles from "./public-forms.module.css";
import { ABOUT_VALUES, CONTACT_CHANNELS, FAQ, HELP_PROCESS, JOIN_FACTS, JOIN_REVIEW, JOIN_STEPS, JOIN_TILES, LEGAL_SECTIONS, OPERATOR_FIELDS, PENDING, PRICING_PENDING, PRIVACY_CONTROLS, PRIVACY_DATA, PRIVACY_THIRD_PARTIES, numbered, pricingRows } from "./public-lists";
import styles from "./public.module.css";
import { paragraphs, publishedStamp, publishedValue, type PublicProfileState } from "../features/public-operator-profile/model";
import { usePublishedOperatorProfile } from "../features/public-operator-profile/use-published-profile";
import { PublicCallbackForm } from "../features/public-callback/public-callback-form";
import { IndicativeRange } from "../features/indicative-prices/indicative-range";
import { PostalCoverageCheck } from "../features/coverage/postal-coverage-check";
import { PublicWarrantyTerms } from "../features/warranty-policy/public-warranty-terms";
import type { PublicTermsState } from "../features/warranty-policy/model";
import type { OperatorField } from "../../lib/features/public-operator-profile/contract";
import { releaseLabel } from "../../shared/release";
import viewStyles from "./public-views.module.css";

const PUBLIC_VIEWS: View[] = ["home", "new", "auth", "help", "pricing", "join", "join-organization", "demo", "about", "privacy", "legal"];

// The PUBLISHED operator profile (never the draft) feeds the informational pages; while it loads,
// fails or is not published, every field keeps « À renseigner par l’exploitant ».
const OperatorContext = createContext<PublicProfileState | null>(null);
// "join" reads the published network terms (PUB-07); nothing else is derived from it there.
const OPERATOR_VIEWS: View[] = ["help", "pricing", "about", "privacy", "legal", "join"];
type Source = { fields: OperatorField[]; optional?: OperatorField[]; join?: string };
/** Published value for a field label, or null ⇒ pending. Required parts must all be published. */
function sourced(state: PublicProfileState | null, source: Source | undefined): string | null {
  if (!source) return null;
  const parts = source.fields.map((f) => publishedValue(state, f));
  if (parts.some((p) => p === null)) return null;
  const extra = (source.optional ?? []).map((f) => publishedValue(state, f)).filter((v): v is string => v !== null);
  return [...(parts as string[]), ...extra].join(source.join ?? ", ");
}
/** Pending notices only while nothing is published (a publication carries every minimum field). */
function WhenUnpublished({ children }: { children: ReactNode }) {
  const state = useContext(OperatorContext);
  return state?.phase === "ready" && state.published ? null : <>{children}</>;
}
function PublishedStamp() {
  const stamp = publishedStamp(useContext(OperatorContext));
  return stamp ? <p className={styles.footnote} data-operator-published-stamp="">{stamp}</p> : null;
}

export function PublicSite({ session, operatorProfile }: { session: PublicSession; /** Tests only. */ operatorProfile?: PublicProfileState }) {
  const known = PUBLIC_VIEWS.includes(session.view);
  const view: View = known ? session.view : "home";
  const [signupAs, setSignupAs] = useState<Role | null>(null);
  const fetched = usePublishedOperatorProfile(operatorProfile === undefined && OPERATOR_VIEWS.includes(view), undefined, view);
  const operator = operatorProfile ?? fetched;
  useEffect(() => {
    const id = view === "help" && session.param === "contact" ? "help-contact"
      : view === "help" && session.param === "garantie" ? "garantie"
      : view === "pricing" && session.param === "zones" ? "zones" : null;
    if (id) {
      const section = document.getElementById(id);
      section?.scrollIntoView({ block: "start" });
      section?.focus({ preventScroll: true });
    }
  }, [view, session.param]);

  const navigate = (target: View) => {
    session.go(target);
  };
  const login = () => {
    setSignupAs(null);
    session.setAuthMode("login");
    session.go("auth");
  };
  const signupArtisan = () => {
    setSignupAs("artisan"); // E65: the artisan entry opens the signup as an artisan
    session.setAuthMode("signup");
    session.go("auth");
  };
  const newRequest = (c?: Category) => {
    if (c) session.setCategory(c);
    session.go("new");
  };

  const alerts = (session.error || session.notice) && (
    <div className="public-alerts">
      <Alerts error={session.error} notice={session.notice} onClearError={() => session.setError("")} onClearNotice={() => session.setNotice("")} />
    </div>
  );

  // UI-PUBLIC-HOME-001 / UI-PUBLIC-REQUEST-001: every public view renders in PublicChrome (theme
  // foundation). home, new and auth first; the informational views below since
  // UI-PUBLIC-VIEWS-001, in the opt-in `viewStyles.skin` (same markup, texts and handlers).
  const chromeHandlers: HomeHandlers = { onNew: newRequest, onLogin: login, onAddress: () => session.go("new", "address"), onNavigate: navigate, onDemo: (role) => session.startDemo(role) };
  if (view === "home")
    return (
      <>
        {alerts}
        <PublicHome gated={!known} handlers={chromeHandlers} />
      </>
    );
  const themedAlerts = (session.error || session.notice) && (
    <div className={formStyles.alerts}>
      <Alerts error={session.error} notice={session.notice} onClearError={() => session.setError("")} onClearNotice={() => session.setNotice("")} />
    </div>
  );
  // Request view: the SHARED RequestForm, unchanged (same props as before), inside an opt-in skin.
  // `#new/<category>` (service pages) pre-selects a KNOWN business category only; a saved draft
  // keeps priority (its own values, and the session category untouched).
  if (view === "new") {
    const linked = CATEGORIES.find((c) => c.id === session.param)?.id;
    const prefill = session.pendingDraft ? undefined : requestPrefill(session.param);
    const initialCategory = !session.pendingDraft ? prefill?.category ?? linked ?? session.categoryId : session.categoryId;
    return (
      <PublicChrome current="new" handlers={chromeHandlers} onHome={() => navigate("home")} mainClassName={formStyles.page}>
        <div className={formStyles.wrap}>
          {themedAlerts}
          <div className={formStyles.requestSkin} data-public-skin="request">
            <RequestForm key={session.param} addressFirst={session.param === "address" || session.param === "scheduled"} initialCategory={initialCategory} initialValues={session.pendingDraft} initialDescription={prefill?.description} initialUrgency={prefill?.urgency} sites={[]} mode="public" busy={session.busy} onBack={() => session.go("home")} onSubmit={async (values) => { session.saveDraft(values); }} onDemo={() => session.startDemo("client", "new")} />
          </div>
        </div>
      </PublicChrome>
    );
  }

  // Account view: the existing AuthView (draft notice + SHARED AuthForm, unchanged) in a skin.
  if (view === "auth")
    return (
      <PublicChrome current="auth" handlers={chromeHandlers} onHome={() => navigate("home")} mainClassName={formStyles.page}>
        <div className={formStyles.wrap}>
          {themedAlerts}
          <div className={formStyles.authSkin} data-public-skin="auth">
            <AuthView session={session} initialRole={signupAs ?? undefined} />
          </div>
        </div>
      </PublicChrome>
    );

  // PublicChrome marks only home/new/auth as current; an informational view is none of them
  // (no aria-current there, as in the chrome's own footer links).
  return (
    <PublicChrome current={view} handlers={chromeHandlers} onHome={() => navigate("home")} mainClassName={`${styles.main} ${viewStyles.main}`}>
      <div className={viewStyles.wrap}>
        {themedAlerts}
        <div className={viewStyles.skin} data-public-skin="info">
          {operatorProfile === undefined && OPERATOR_VIEWS.includes(view) && fetched.phase === "error" && (
            // E79: an outage is never presented as « À renseigner par l’exploitant ».
            <div className="alert error" role="alert" data-operator-profile-error="">
              <span>Les informations de l’exploitant n’ont pas pu être chargées pour le moment. Les mentions ci-dessous ne reflètent pas leur publication.</span>
              <button type="button" className="button outline" onClick={fetched.retry}>Réessayer</button>
            </div>
          )}
          <OperatorContext.Provider value={operator}>
          {view === "help" ? (
            <HelpView onNew={() => newRequest()} onLogin={login} />
          ) : view === "pricing" ? (
            <PricingView onNew={() => newRequest()} />
          ) : view === "join" ? (
            <JoinView onSignup={signupArtisan} onDemo={() => session.startDemo("artisan")} />
          ) : view === "join-organization" ? (
            <JoinOrganizationView session={session} />
          ) : view === "demo" ? (
            <DemoEntryView session={session} />
          ) : view === "about" ? (
            <AboutView onNew={() => newRequest()} onJoin={() => navigate("join")} onLogin={login} />
          ) : view === "privacy" ? (
            <PrivacyView onHome={() => navigate("home")} onLogin={login} />
          ) : view === "legal" ? (
            <LegalView onHome={() => navigate("home")} />
          ) : null}
          </OperatorContext.Provider>
        </div>
      </div>
    </PublicChrome>
  );
}

// ---- Shared pieces --------------------------------------------------------------------------
/** Small blue pill above a title (M46, V8-C03 section labels). */
function Kicker({ icon = "bolt", children }: { icon?: string; children: ReactNode }) {
  return (
    <span className={styles.kicker}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}
/** Icon tile + title + text, used by steps, facts, tiles and value cards. */
function IconTile({ icon, size = 44 }: { icon: string; size?: number }) {
  return (
    <span className={styles.tile} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
function StepsRow({ steps, numbered: withNumbers = true, columns }: { steps: { icon: string; title: string; text: string }[]; numbered?: boolean; columns: 3 | 4 }) {
  return (
    <ol className={`${styles.stepsRow} ${columns === 4 ? styles.stepsRow4 : ""}`}>
      {steps.map((step, index) => (
        <li key={step.title}>
          <span className={styles.stepVisual}>
            <IconTile icon={step.icon} size={56} />
            {withNumbers && <span className={styles.stepBadge}>{index + 1}</span>}
          </span>
          <div>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </div>
          {index < steps.length - 1 && <span className={styles.stepArrow} aria-hidden="true"><Icon name="arrow" size={18} /></span>}
        </li>
      ))}
    </ol>
  );
}
function FactsStrip({ facts, columns }: { facts: { icon: string; title: string; text: string }[]; columns: 3 | 4 }) {
  return (
    <ul className={`${styles.facts} ${columns === 3 ? styles.facts3 : ""}`}>
      {facts.map((fact) => (
        <li key={fact.title}>
          <IconTile icon={fact.icon} size={40} />
          <div>
            <strong>{fact.title}</strong>
            <span>{fact.text}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
function Crumb({ onHome, current }: { onHome: () => void; current: string }) {
  return (
    <nav className={styles.crumb} aria-label="Fil d’Ariane">
      <button type="button" className="text-button" onClick={onHome}>Accueil</button>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{current}</span>
    </nav>
  );
}

// ---- Account entry (M49: centred card; the shared form is untouched) -------------------------
function AuthView({ session, initialRole }: { session: PublicSession; initialRole?: Role }) {
  return (
    <div className={styles.authPage}>
      {session.pendingDraft && (
        <div className="alert warning" role="status">
          <Icon name="document" />
          <span>Votre brouillon de demande sera repris après connexion.</span>
        </div>
      )}
      <AuthForm mode={session.authMode} onMode={(mode) => session.setAuthMode(mode)} busy={session.busy} onSubmit={async (values) => { if (session.authMode === "signup") await session.signUp(values); else if (session.authMode === "reset") await session.resetPassword(values.email); else await session.signIn(values.email, values.password); }} onDemo={() => session.startDemo("client")} initial={session.booking?.contact ? { email: session.booking.contact.email, first_name: session.booking.contact.first_name, last_name: session.booking.contact.last_name } : undefined} key={initialRole ?? "client"} initialRole={initialRole} />
    </div>
  );
}

// ---- Help (M46 process + M70 FAQ + M42 column) ---------------------------------------------
// Contact (PUB-04): only real channels; the others say they are pending. No form pretends to send.
const CONTACT_SOURCES: Record<string, { field: OperatorField; href: (v: string) => string }> = {
  "Adresse e-mail de contact": { field: "public_email", href: (v) => `mailto:${v}` },
  "Téléphone": { field: "public_phone", href: (v) => `tel:${v}` },
};
function ContactBlock({ onLogin, headingId }: { onLogin: () => void; headingId: string }) {
  const operator = useContext(OperatorContext);
  return (
    <section className={`panel ${styles.block}`} aria-labelledby={headingId} data-public-contact="">
      <h3 id={headingId} tabIndex={-1} style={{ scrollMarginTop: 88 }}>Contact</h3>
      <dl className={styles.legalFields}>
        {/* The callback channel is described only by its live form (« Être rappelé »), never statically. */}
        {CONTACT_CHANNELS.map((c) => (
          <div key={c.label} data-contact-channel={c.state}>
            <dt>{c.label} :</dt>
            <dd>
              {(() => {
                const src = CONTACT_SOURCES[c.label];
                const value = src ? publishedValue(operator, src.field) : null;
                if (src && value) return <a href={src.href(value)} data-operator-value={src.field}>{value}</a>;
                return c.state === "pending" ? <><strong>{PENDING}</strong> — {c.text}</> : c.text;
              })()}
            </dd>
          </div>
        ))}
      </dl>
      <button type="button" className="button outline" onClick={onLogin} data-contact-login="">Se connecter pour écrire à l’assistance</button>
      <PublishedStamp />
    </section>
  );
}
/** PUB-10: a published long text as plain-text paragraphs (never HTML); pending wording otherwise. */
function PrivacyText({ field, title }: { field: "privacy_retention" | "privacy_notice"; title: string }) {
  const value = publishedValue(useContext(OperatorContext), field);
  return (
    <div className={styles.legalFields} data-privacy-text={field} data-published={value ? "" : undefined}>
      <h3>{title}</h3>
      {value ? paragraphs(value).map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>) : <p>{PENDING}</p>}
    </div>
  );
}
/** PUB-07 / PUB-09: a published long text as plain-text paragraphs; nothing at all when absent. */
function PublishedBlock({ field, title, headingId }: { field: "team_text" | "network_terms"; title: string; headingId: string }) {
  const value = publishedValue(useContext(OperatorContext), field);
  if (!value) return null;
  return (
    <section className={styles.docSection} aria-labelledby={headingId} data-published-text={field}>
      <h2 id={headingId}>{title}</h2>
      {paragraphs(value).map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)}
    </section>
  );
}
/** Network terms on the artisan application page: the published text, else the existing notice. */
function NetworkTerms() {
  const value = publishedValue(useContext(OperatorContext), "network_terms");
  if (!value)
    return <Unavailable title="Commission, délais de règlement et conditions du réseau" reason="Non définis à ce stade. Aucun pourcentage, aucun délai de versement ni condition contractuelle n’est publié avant décision de l’exploitant." blocker="Q-PDF-15 / Q-PDF-05" />;
  return <PublishedBlock field="network_terms" title="Conditions du réseau publiées par l’exploitant" headingId="join-network-terms" />;
}
/** Full published privacy notice, or the existing honest placeholder while it is not published. */
function PrivacyNotice() {
  const value = publishedValue(useContext(OperatorContext), "privacy_notice");
  if (!value)
    return <Unavailable title="Politique complète, contact DPO et préférences : à publier avant ouverture" reason="Les modalités d’accès, de rectification et de suppression, la durée de conservation, le contact du délégué à la protection des données et les préférences de confidentialité seront publiés avant l’ouverture commerciale." blocker="PUB-10" />;
  return (
    <div className={styles.legalFields} data-privacy-text="privacy_notice" data-published="">
      <h3>Politique de confidentialité de l’exploitant</h3>
      {paragraphs(value).map((p, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{p}</p>)}
    </div>
  );
}

function PendingFields({ fields, label, sources = {} }: { fields: string[]; label: string; sources?: Record<string, Source> }) {
  const operator = useContext(OperatorContext);
  return (
    <dl className={styles.legalFields} aria-label={label} data-pending-fields="">
      {fields.map((field) => (
        <div key={field}>
          <dt>{field} :</dt>
          <dd>{sourced(operator, sources[field]) ?? PENDING}</dd>
        </div>
      ))}
    </dl>
  );
}

function HelpView({ onNew, onLogin, warrantyTerms }: { onNew: () => void; onLogin: () => void; /** Tests only. */ warrantyTerms?: PublicTermsState }) {
  return (
    <div className={styles.page}>
      <Kicker>Dépannage électrique</Kicker>
      <PageTitle title="Comment ça marche" subtitle="Comprendre votre demande, votre devis et votre paiement, étape par étape." />
      <section className={`panel ${styles.processCard}`} aria-labelledby="process-title">
        <h2 id="process-title" className={styles.processTitle}>Le parcours en quatre étapes</h2>
        <StepsRow steps={HELP_PROCESS} columns={4} />
      </section>
      <div className={styles.helpLayout}>
        <section className={`panel ${styles.faqPanel}`} aria-labelledby="faq-title">
          <h2 id="faq-title"><IconTile icon="help" size={36} />Questions fréquentes</h2>
          <div className={styles.faqList}>
            {FAQ.map((item) => (
              <details key={item.question} className={styles.faqItem}>
                <summary>
                  <IconTile icon={item.icon} size={36} />
                  <span className={styles.faqQuestion}>{item.question}</span>
                  <Icon name="arrow" size={18} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
          <div className={styles.faqFoot}>
            <IconTile icon="message" size={40} />
            <div>
              <strong>Vous ne trouvez pas votre réponse ?</strong>
              <span>Une fois connecté, l’assistance répond dans votre espace. Aucun appel, email ni SMS n’est promis.</span>
            </div>
          </div>
        </section>
        <aside className={styles.helpAside}>
          <section className={styles.helpCta}>
            <IconTile icon="bolt" size={44} />
            <h2>Besoin d’une intervention ?</h2>
            <p>Commencez par décrire le problème. Vous pourrez préciser le lieu et votre besoin.</p>
            <button type="button" className="button primary full" onClick={onNew}>Créer une demande</button>
          </section>
          <ContactBlock onLogin={onLogin} headingId="help-contact" />
          <InstallPanel />
        </aside>
      </div>
      {/* PUB-06: the PUBLISHED warranty conditions only, as plain text; none ⇒ pending sentence. */}
      <div id="garantie" data-public-warranty="" tabIndex={-1} style={{ scrollMarginTop: 88 }}>
        <PublicWarrantyTerms state={warrantyTerms} />
      </div>
      <PublicCallbackForm />
    </div>
  );
}

// ---- Pricing (M38) --------------------------------------------------------------------------
function PricingView({ onNew }: { onNew: () => void }) {
  const rows = pricingRows(CATEGORIES, category);
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Les prix, <span className={styles.accent}>en trois montants</span></h1>
          <p className={styles.subtitle}>L’estimation indicative, le devis que vous acceptez et le montant effectivement réglé sont trois choses distinctes.</p>
        </div>
        <div>
          <Unavailable title="Barème officiel, frais de déplacement et majorations" reason="À définir par l’exploitant. Aucun tarif public, frais de déplacement ou majoration (soir, week-end, urgence) n’est publié tant que cette décision n’est pas prise." blocker="PUB-02" />
          <PendingFields fields={PRICING_PENDING} label="Décisions tarifaires en attente" sources={{ "Zone desservie": { fields: ["service_area"] } }} />
        </div>
      </div>
      <div id="zones" tabIndex={-1} style={{ scrollMarginTop: 88 }}><PostalCoverageCheck /></div>
      <section className={`panel ${styles.priceTableCard}`} aria-labelledby="pricing-table">
        <h2 id="pricing-table" className={styles.srOnly}>Fourchettes indicatives par type de panne</h2>
        <table className={styles.table}>
          <caption>Fourchettes indicatives de préparation du service, pas un barème contractuel.</caption>
          <thead>
            <tr>
              <th scope="col">Type de problème</th>
              <th scope="col">Fourchette indicative</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className={styles.rowLabel}>
                    <IconTile icon={row.icon} size={40} />
                    <span>
                      {row.label}
                      <small>{row.description}</small>
                    </span>
                  </span>
                </th>
                <td><IndicativeRange category={row.id as Category} bare /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.footnote}>TVA : selon le taux applicable indiqué sur le devis. Les montants ci-dessus n’incluent ni déplacement ni majoration, qui restent à définir.</p>
      </section>
      <section className={`panel ${styles.block}`} aria-labelledby="pricing-steps">
        <h2 id="pricing-steps">Trois montants, trois moments</h2>
        <ol className={`${styles.steps} ${styles.steps3}`}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>L’estimation indicative</strong>
              <p>Une fourchette affichée dès la description du problème, calculée à partir du type de panne. Elle sert à se situer ; ce n’est ni un prix garanti ni un engagement.</p>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Le devis de l’artisan</strong>
              <p>Établi par l’artisan affecté, il détaille les prestations, les quantités, le sous-total, la TVA et le total. Aucun travail ne commence avant que vous l’ayez accepté.</p>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Le montant réglé</strong>
              <p>Proposé une fois l’intervention terminée, sur la base du devis accepté. Le paiement se fait toujours sur la plateforme (carte via votre suivi, lien sécurisé ou QR code), jamais directement à l’artisan ; il n’est considéré comme encaissé qu’après confirmation de la plateforme, jamais sur la seule redirection.</p>
            </div>
          </li>
        </ol>
      </section>
      <section className={styles.cta}>
        <div>
          <h2>Commencer par le problème</h2>
          <p>L’estimation s’affiche dès la première étape, avant toute création de compte.</p>
        </div>
        <button type="button" className="button primary" onClick={onNew}>Décrire mon problème <Icon name="arrow" size={16} /></button>
      </section>
    </div>
  );
}

// ---- Join the network (M60) -----------------------------------------------------------------
function JoinView({ onSignup, onDemo }: { onSignup: () => void; onDemo: () => void }) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Rejoindre le réseau <span className={styles.accent}>d’électriciens</span></h1>
          <p className={styles.subtitle}>Un dossier en cinq parties, examiné par l’opérateur avant tout accès aux missions.</p>
        </div>
      </div>
      <FactsStrip facts={JOIN_FACTS} columns={3} />
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-tiles">
            <h2 id="join-tiles"><IconTile icon="star" size={36} />Ce que l’espace artisan permet</h2>
            <ul className={styles.tiles}>
              {JOIN_TILES.map((tile) => (
                <li key={tile.title}>
                  <IconTile icon={tile.icon} size={44} />
                  <strong>{tile.title}</strong>
                  <span>{tile.text}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className={`panel ${styles.block}`} aria-labelledby="join-review">
            <h2 id="join-review">Comment se déroule l’examen</h2>
            <ul className={styles.list}>
              {JOIN_REVIEW.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        </div>
        <div className={styles.stack}>
          <section className={`panel ${styles.block}`} aria-labelledby="join-steps">
            <h2 id="join-steps"><IconTile icon="check" size={36} />Ce que contient le dossier</h2>
            <ol className={styles.checklist}>
              {JOIN_STEPS.map((step) => (
                <li key={step.title}>
                  <span className={styles.checkMark} aria-hidden="true"><Icon name="check" size={14} /></span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <NetworkTerms />
          <section className={styles.cta}>
            <div>
              <h2>Créer mon compte artisan</h2>
              <p>Aucun paiement n’est demandé à l’inscription. Votre dossier devra être approuvé avant d’accepter des missions.</p>
            </div>
            <div className={`${styles.ctaActions} ${styles.ctaStack}`}>
              <button type="button" className={`button primary ${styles.wideCta}`} onClick={onSignup}>Créer mon compte artisan <Icon name="arrow" size={16} /></button>
              <button type="button" className="button outline" onClick={onDemo}>Explorer l’espace artisan en démonstration</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---- About (V8-C03) -------------------------------------------------------------------------
function AboutView({ onNew, onJoin, onLogin }: { onNew: () => void; onJoin: () => void; onLogin: () => void }) {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="about-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <h1 id="about-title" className={styles.title}>À propos de l’application</h1>
            <p>Une application de dépannage électrique en préparation. Cette page décrit ce qu’elle fait, pas plus.</p>
            <span className={styles.rule} aria-hidden="true" />
          </div>
        </div>
      </section>
      <div className={styles.aboutColumns}>
        <section aria-labelledby="about-mission" className={styles.aboutMission}>
          <Kicker icon="bolt">Ce que fait l’application</Kicker>
          <h2 id="about-mission">Mettre en relation, sans ambiguïté sur le prix</h2>
          <p className={styles.lead}>Mettre en relation une personne confrontée à une panne électrique et un artisan électricien, avec un parcours lisible : description du problème, estimation indicative, attribution d’un artisan, devis, intervention, puis règlement.</p>
          <p>Pour les particuliers ; les artisans électriciens ; les entreprises clientes qui gèrent plusieurs sites (copropriétés, restauration, bureaux, établissements recevant du public) ; et l’exploitant de la plateforme, qui examine les dossiers artisans et supervise les interventions.</p>
          <div className={styles.aboutCta}>
            <IconTile icon="bolt" size={44} />
            <div>
              <strong>Besoin d’un électricien ?</strong>
              <span>Décrivez la panne ; l’estimation indicative s’affiche avant toute création de compte.</span>
              <button type="button" className="text-button" onClick={onNew}>Demander une intervention <Icon name="arrow" size={14} /></button>
            </div>
          </div>
        </section>
        <section aria-labelledby="about-values">
          <Kicker icon="shield">Ce qui guide le service</Kicker>
          <h2 id="about-values">Trois règles, sans exception</h2>
          <ul className={styles.valueCards}>
            {ABOUT_VALUES.map((value) => (
              <li key={value.title}>
                <IconTile icon={value.icon} size={44} />
                <strong>{value.title}</strong>
                <span>{value.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className={`panel ${styles.block} ${styles.narrowBlock}`} aria-labelledby="about-operator">
        <h2 id="about-operator">Exploitant, équipe et histoire</h2>
        <OperatorAbout />
        <PublishedBlock field="team_text" title="L’équipe" headingId="about-team" />
        <PendingFields
          fields={OPERATOR_FIELDS}
          label="Présentation de l’exploitant"
          sources={{
            "Nom de l’exploitant et forme juridique": { fields: ["legal_name", "legal_form"] },
            "Personnes responsables": { fields: ["publication_director"] },
            "Zone d’intervention couverte": { fields: ["service_area"] },
            "Coordonnées de contact": { fields: ["public_email"], optional: ["public_phone"], join: " · " },
          }}
        />
        <PublishedStamp />
        <WhenUnpublished>
          <Unavailable title="Identité de l’exploitant, équipe et coordonnées à renseigner" reason="Le nom définitif, la société exploitante, les personnes responsables et les moyens de contact seront publiés avant l’ouverture commerciale. Aucune information de substitution n’est affichée." blocker="PUB-08 / PUB-09" />
        </WhenUnpublished>
      </section>
      <div className={styles.narrowBlock}>
        <ContactBlock onLogin={onLogin} headingId="about-contact" />
      </div>
      <section className={`${styles.cta} ${styles.narrowBlock}`}>
        <div>
          <h2>Et maintenant ?</h2>
          <p>Décrivez une panne ou découvrez le dossier artisan.</p>
        </div>
        <div className={styles.ctaActions}>
          <button type="button" className="button primary" onClick={onNew}>Demander une intervention</button>
          <button type="button" className="button outline" onClick={onJoin}>Rejoindre le réseau</button>
        </div>
      </section>
    </div>
  );
}

// ---- Privacy (V8-C05) -----------------------------------------------------------------------
function PrivacyView({ onHome, onLogin }: { onHome: () => void; onLogin: () => void }) {
  const sections = ["Données enregistrées par l’application", "Services tiers utilisés aujourd’hui", "Mode démonstration", "Traceurs et mesure d’audience", "Vos contrôles", "Vos droits et le contact"];
  return (
    <div className={`${styles.page} ${styles.document}`}>
      <Crumb onHome={onHome} current="Confidentialité" />
      <h1 className={styles.title}>Confidentialité</h1>
      <p className={styles.subtitle}>Ce que l’application enregistre aujourd’hui, où, et ce qui reste à publier. Cette page décrit le produit réel ; la politique complète sera publiée avant l’ouverture commerciale.</p>
      <section className={styles.docSection} aria-labelledby="privacy-data">
        <h2 id="privacy-data">{numbered(0, sections[0])}</h2>
        <ul className={styles.docList}>
          {PRIVACY_DATA.map((item) => (
            <li key={item.label}><strong>{item.label} :</strong> {item.text}</li>
          ))}
        </ul>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-third-parties" data-privacy-third-parties="">
        <h2 id="privacy-third-parties">{numbered(1, sections[1])}</h2>
        <ul className={styles.docList}>
          {PRIVACY_THIRD_PARTIES.map((item) => (
            <li key={item.name}><strong>{item.name} :</strong> {item.text}</li>
          ))}
        </ul>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-demo">
        <h2 id="privacy-demo">{numbered(2, sections[2])}</h2>
        <p>La démonstration n’envoie rien à un serveur : ses exemples et vos modifications sont conservés uniquement dans ce navigateur (localStorage). Pour les effacer, utilisez le bouton « Réinitialiser » du bandeau de démonstration, ou supprimez les données de site de ce navigateur.</p>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-trackers">
        <h2 id="privacy-trackers">{numbered(3, sections[3])}</h2>
        <p>Cette version ne contient aucun traceur publicitaire ni outil de mesure d’audience. Un brouillon de demande non envoyé peut être conservé localement dans votre navigateur jusqu’à votre connexion.</p>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-controls" data-privacy-controls="">
        <h2 id="privacy-controls">{numbered(4, sections[4])}</h2>
        <ul className={styles.docList}>
          {PRIVACY_CONTROLS.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <button type="button" className="button outline" onClick={onLogin}>Se connecter à mon espace</button>
      </section>
      <section className={styles.docSection} aria-labelledby="privacy-rights">
        <h2 id="privacy-rights">{numbered(5, sections[5])}</h2>
        <PendingFields
          fields={["Responsable du traitement", "Contact pour l’exercice des droits (accès, rectification, suppression)"]}
          label="Informations de confidentialité"
          sources={{
            "Responsable du traitement": { fields: ["privacy_controller"] },
            "Contact pour l’exercice des droits (accès, rectification, suppression)": { fields: ["privacy_email"] },
          }}
        />
        <PrivacyText field="privacy_retention" title="Durées de conservation hors position partagée" />
        <PublishedStamp />
        <PrivacyNotice />
      </section>
      <p className={styles.docFoot}>
        <Icon name="shield" size={20} />
        <span>Aucune adresse de contact n’est affichée tant que l’exploitant n’est pas désigné ; aucun cookie analytique ou marketing n’est utilisé.</span>
      </p>
    </div>
  );
}

// ---- Legal notice (M63) ----------------------------------------------------------------------
// The SIRET is optional: its row exists only once published (never as a pending field).
const SIRET_ROW = "Numéro SIRET de l’établissement";
const SIRET_AFTER = "Numéro SIREN et numéro de TVA";
const LEGAL_SOURCES: Record<string, Record<string, Source>> = {
  "Éditeur": {
    "Raison sociale et forme juridique": { fields: ["legal_name", "legal_form"] },
    "Adresse du siège": { fields: ["hq_address"] },
    "Numéro SIREN et numéro de TVA": { fields: ["siren"], optional: ["vat_number"], join: " · TVA " },
    [SIRET_ROW]: { fields: ["siret"] },
    "Directeur ou directrice de la publication": { fields: ["publication_director"] },
    "Adresse de contact": { fields: ["public_email"] },
  },
  "Hébergeur": { "Nom de l’hébergeur": { fields: ["host_name"] }, "Adresse": { fields: ["host_address"] }, "Coordonnées de contact": { fields: ["host_contact"] } },
  "Propriété intellectuelle": { "Titulaire des droits sur le nom, le logo et les contenus": { fields: ["rights_holder"] } },
  "Données personnelles": { "Contact pour l’exercice des droits": { fields: ["privacy_email"] } },
};
/** Published presentation text and display name, only when published. */
function OperatorAbout() {
  const operator = useContext(OperatorContext);
  const name = publishedValue(operator, "display_name");
  const about = publishedValue(operator, "about_text");
  if (!name && !about) return null;
  return (
    <div data-operator-about="">
      {name && <h3>{name}</h3>}
      {about && <p>{about}</p>}
    </div>
  );
}
function LegalView({ onHome }: { onHome: () => void }) {
  const siretPublished = publishedValue(useContext(OperatorContext), "siret") !== null;
  const rows = (fields: string[]) => (siretPublished ? fields.flatMap((field) => (field === SIRET_AFTER ? [field, SIRET_ROW] : [field])) : fields);
  return (
    <div className={`${styles.page} ${styles.document}`}>
      <Crumb onHome={onHome} current="Mentions légales" />
      <h1 className={styles.title}>Mentions légales</h1>
      <p className={styles.subtitle}>Structure des mentions obligatoires. Chaque champ sera complété par l’exploitant avant publication.</p>
      {LEGAL_SECTIONS.map((section, index) => (
        <section key={section.title} className={styles.docSection} aria-labelledby={`legal-section-${index}`}>
          <h2 id={`legal-section-${index}`}>{numbered(index, section.title)}</h2>
          <PendingFields fields={rows(section.fields)} label={section.title} sources={LEGAL_SOURCES[section.title]} />
        </section>
      ))}
      <PublishedStamp />
      <p className={styles.footnote} data-app-version="">{releaseLabel()}</p>
      <WhenUnpublished>
        <Unavailable title="Mentions légales à compléter" reason="Aucune société, adresse ou identifiant fictif n’est affiché. Les informations ci-dessus seront renseignées par l’exploitant avant l’ouverture commerciale." blocker="PUB-08" />
      </WhenUnpublished>
    </div>
  );
}

// Manually shared organisation invitation: the code is kept in this browser and accepted
// server-side after login, for the verified recipient only. No email is sent by the app.
function JoinOrganizationView({ session }: { session: PublicSession }) {
  const valid = /^[0-9a-f]{64}$/.test(session.param);
  return (
    <section className={`panel ${styles.invitePanel}`} aria-labelledby="join-org-title">
      <span className="empty-icon">
        <Icon name="users" size={28} />
      </span>
      <h1 id="join-org-title">Invitation à rejoindre une organisation</h1>
      {valid ? (
        <>
          <p>Un propriétaire d’organisation vous a transmis ce lien. Connectez-vous avec l’adresse email qui a reçu l’invitation : elle sera acceptée automatiquement après la connexion, puis l’organisation apparaîtra dans votre espace.</p>
          <p>Le code n’est valable qu’une fois, pour l’adresse invitée, jusqu’à sa date d’expiration fixée par le propriétaire.</p>
          <div className={styles.inviteActions}>
            <button type="button" className="button primary" onClick={() => session.keepInvitation(session.param)}>Se connecter pour accepter</button>
            <button type="button" className="button outline" onClick={() => session.go("home")}>Plus tard</button>
          </div>
        </>
      ) : (
        <>
          <p role="alert">Ce lien d’invitation est incomplet ou invalide. Demandez un nouveau lien au propriétaire de l’organisation.</p>
          <button type="button" className="button outline" onClick={() => session.go("home")}>Revenir à l’accueil</button>
        </>
      )}
    </section>
  );
}

const DEMO_ROLES = ["client", "artisan", "manager", "admin"] as const;
// Explicit demonstration entry (#demo/<role> or #demo/<role>-<view>): isolated examples,
// never a live account. The controller ignores it when a live session exists.
function DemoEntryView({ session }: { session: PublicSession }) {
  // #demo/<role>[-<view>[.<id>]] — the optional id selects a demo dossier for the view.
  const [path, id] = session.param.split(".");
  const [head, ...rest] = path.split("-");
  const role = (DEMO_ROLES as readonly string[]).includes(head) ? (head as (typeof DEMO_ROLES)[number]) : "client";
  const target = rest.join("-");
  useEffect(() => {
    session.startDemo(role, (target || undefined) as View | undefined, id || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, target, id]);
  return (
    <section className={`panel ${styles.invitePanel}`} role="status">
      <h1>Ouverture de la démonstration…</h1>
      <p>Données fictives conservées dans ce navigateur. Aucun artisan contacté, aucun débit bancaire.</p>
    </section>
  );
}
