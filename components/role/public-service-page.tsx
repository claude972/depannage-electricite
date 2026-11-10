"use client";
// Public service page (FASTSPLIT-PUBLIC-SERVICE-PAGES-001), rendered by app/prestations/[slug].
// Same PublicChrome / ThemeSurface as the public home; this route is outside the hash-routed app,
// so every chrome action is a real navigation back to it (/#new/<category>, /#auth, /#help…).
// The price is the canonical indicative estimate of the category, labelled as such.
import { useEffect, useState } from "react";
import { category, money } from "../app/format";
import { PublicChrome, serviceChromeHandlers } from "./public-chrome";
import { SERVICE_STEPS, relatedServices, serviceEstimate, servicePath, type ServiceEntry } from "./public-service-catalog";
import { Icon } from "../app/icons";
import { BookingBar, BookingWizard } from "./public-booking";
import { IndicativeRange, useIndicativeText } from "../features/indicative-prices/indicative-range";
import bookingStyles from "./public-booking.module.css";
import styles from "./public-service.module.css";

export { serviceChromeHref, serviceChromeHandlers } from "./public-chrome";

/** Shared third question of the hero FAQ (each service brings its own two first). */
const COMMON_FAQ = {
  question: "Quand le prix est-il confirmé ?",
  answer: "Après le diagnostic, dans le devis détaillé de l’artisan. Rien n’est engagé tant que vous ne l’avez pas accepté.",
};

export function PublicServicePage({ service, initialOpen = false }: { service: ServiceEntry; initialOpen?: boolean }) {
  const estimate = serviceEstimate(service.category);
  // Booking wizard: unchanged existing estimate (the server reserves its own snapshot). Public
  // displays (hero, fixed bar, related cards): the five ranges of GET /api/public/indicative-prices.
  const range = `${money(estimate.min)} – ${money(estimate.max)}`;
  const shownRange = useIndicativeText(service.category);
  // Main CTA, final band and the fixed bar's « Confirmer » share ONE action: open the wizard here.
  const [open, setOpen] = useState(initialOpen);
  // The server HTML shows « Confirmer » before React has hydrated: a click then would be lost
  // (no handler yet). The buttons stay visibly disabled (aria-busy) until the effect runs, i.e.
  // once the handlers are attached; openBooking also refuses before that point.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const openBooking = () => {
    if (ready) setOpen(true);
  };
  const confirmProps = {
    disabled: !ready,
    "aria-busy": ready ? undefined : true,
    "aria-describedby": ready ? undefined : "booking-preparing",
  } as const;
  const crumb = (
    <nav className={styles.crumb} aria-label="Fil d’Ariane">
      <a href="/">Accueil</a>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{service.title}</span>
    </nav>
  );
  if (open)
    return (
      <PublicChrome current="service" className={styles.withBar} handlers={serviceChromeHandlers()} onHome={() => window.location.assign("/")} mainClassName={styles.main}>
        <div className={styles.wrap}>
          {crumb}
          <BookingWizard service={service} range={range} onClose={() => setOpen(false)} />
        </div>
      </PublicChrome>
    );
  return (
    <PublicChrome current="service" className={`${styles.withBar} ${styles.withCompactBar}`} handlers={serviceChromeHandlers()} onHome={() => window.location.assign("/")} mainClassName={styles.main}>
      <div className={styles.wrap}>
        <a className={styles.backLink} href="/prestations">
          <span aria-hidden="true">←</span> Catalogue
        </a>

        {/* Hero: photo left; right column: title, indicative range, pictogram panel, CTA, top FAQ. */}
        <section className={styles.hero} aria-labelledby="service-title">
          <div className={styles.heroHeading}>
            <span className={styles.eyebrow}>{category(service.category).label}</span>
            <h1 id="service-title" className={styles.heroTitle}>{service.title}</h1>
            <p>{service.intro}</p>
          </div>
          <figure className={styles.heroMedia}>
            <img src={service.photo.src} alt={service.alt} width={service.photo.width} height={service.photo.height} decoding="async" style={{ objectPosition: service.position }} />
          </figure>
          <div className={styles.price} data-service-price="">
            <span>Estimation indicative</span>
            <strong data-indicative-range={service.category}>{shownRange}</strong>
            <p>Le prix final est fixé par le devis que vous acceptez.</p>
          </div>
          <div className={styles.pictoPanel}>
            <ul className={styles.pictos} aria-label="Précisés dans le devis" data-service-pictos="">
              <li>
                <span className={styles.pictoIcon} aria-hidden="true"><Icon name="truck" size={20} /></span>
                Déplacement
              </li>
              <li>
                <span className={styles.pictoIcon} aria-hidden="true"><Icon name="wrench" size={20} /></span>
                Main-d’œuvre
              </li>
              <li>
                <span className={styles.pictoIcon} aria-hidden="true"><Icon name="box" size={20} /></span>
                Matériel
              </li>
            </ul>
            <p className={styles.pictoNote}>Précisés dans le devis</p>
          </div>
          <div className={styles.ctaRow}>
            <p className={styles.proof}>Demande sans engagement · Rien n’est envoyé avant votre confirmation</p>
            {!ready && (
              <span id="booking-preparing" role="status" className={styles.preparing}>
                Préparation du formulaire…
              </span>
            )}
            <button type="button" className={styles.cta} onClick={openBooking} {...confirmProps} data-service-cta="" data-booking-open="">
              Demander cette intervention
            </button>
          </div>
          <div className={styles.topFaq} data-service-faq="">
            {[...service.faq, COMMON_FAQ].slice(0, 3).map((item) => (
              <details key={item.question} className={styles.faqRow}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Full-width bands: heading + pictogram left, content right. */}
        <section className={styles.band} aria-labelledby="service-know">
          <div className={styles.bandInner}>
            <div className={styles.bandHead}>
              <span className={styles.pictoIcon} aria-hidden="true"><Icon name="info" size={22} /></span>
              <h2 id="service-know">Ce qu’il faut savoir</h2>
            </div>
            <div className={styles.bandBody}>
              <ul className={styles.list}>
                {service.covers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="service-included">
          <div className={styles.bandHead}>
            <span className={styles.pictoIcon} aria-hidden="true"><Icon name="check" size={22} /></span>
            <h2 id="service-included">Ce qui est inclus</h2>
          </div>
          <div className={styles.bandBody}>
            <p>Selon le diagnostic, l’intervention peut comprendre :</p>
            <ul className={styles.list}>
              {service.checks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={styles.note}>Le contenu exact est précisé dans le devis détaillé de l’artisan.</p>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="service-extras">
          <div className={styles.bandHead}>
            <span className={styles.pictoIcon} aria-hidden="true"><Icon name="layers" size={22} /></span>
            <h2 id="service-extras">Ce qui n’est pas inclus</h2>
          </div>
          <div className={styles.bandBody}>
            <p>Selon le diagnostic, ces éléments peuvent faire l’objet d’un chiffrage distinct, précisé dans le devis détaillé :</p>
            <ul className={styles.list}>
              {service.extras.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
        <section className={styles.section} aria-labelledby="service-steps">
          <div className={styles.bandHead}>
            <span className={styles.pictoIcon} aria-hidden="true"><Icon name="list" size={22} /></span>
            <h2 id="service-steps">Déroulement</h2>
          </div>
          <ol className={`${styles.bandBody} ${styles.steps}`}>
            {SERVICE_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <span>
                  <strong>{step.title}</strong>
                  <span>{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* Related services: real links, photo + title + indicative range. */}
        <section className={styles.related} aria-labelledby="service-related">
          <h2 id="service-related">Autres dépannages</h2>
          <ul className={styles.relatedGrid}>
            {relatedServices(service.slug).map((other) => {
              return (
                <li key={other.slug}>
                  <a className={styles.relatedCard} href={servicePath(other.slug)} data-related={other.slug}>
                    <img src={other.photo.src} alt="" width={other.photo.width} height={other.photo.height} loading="lazy" decoding="async" style={{ objectPosition: other.position }} />
                    <span className={styles.relatedBody}>
                      <strong>{other.title}</strong>
                      <IndicativeRange category={other.category} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        <p className={styles.credit}>Photo d’illustration (Pexels) : elle ne représente ni notre équipe ni un artisan de la plateforme.</p>
      </div>
      <BookingBar title={service.title} range={shownRange} compact>
        <button type="button" className={bookingStyles.barButton} onClick={openBooking} {...confirmProps} data-booking-open="">
          Demander cette intervention
        </button>
      </BookingBar>
    </PublicChrome>
  );
}
