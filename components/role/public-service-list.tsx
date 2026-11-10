"use client";

import { category } from "../app/format";
import { Icon } from "../app/icons";
import { IndicativeRange } from "../features/indicative-prices/indicative-range";
import { PublicChrome, serviceChromeHandlers } from "./public-chrome";
import { SERVICES, servicePath, type ServiceEntry } from "./public-service-catalog";
import styles from "./public-home.module.css";

export function PublicServiceList({ services }: { services: ServiceEntry[] }) {
  return (
    <ul className={styles.ivGrid}>
      {services.map((service) => (
        <li key={service.slug}>
          <a className={styles.ivc} href={servicePath(service.slug)} data-service-card={service.slug}>
            <img src={service.photo.src} alt="" width={64} height={60} loading="lazy" decoding="async" style={{ objectPosition: service.position }} />
            <span className={styles.ivcBody}>
              <span className={styles.eyebrow}>{category(service.category).label}</span>
              <strong>{service.title}</strong>
              <span className={styles.ivcPrice}><IndicativeRange category={service.category} /></span>
            </span>
            <Icon name="arrow" size={17} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PublicCatalogue() {
  return (
    <PublicChrome current="catalogue" handlers={serviceChromeHandlers()} onHome={() => window.location.assign("/")} mainClassName={styles.main}>
      <div className={`${styles.wrap} ${styles.cataloguePage}`}>
        <a className={styles.textLink} href="/"><Icon name="back" size={17} /> Retour à l’accueil</a>
        <h1>Quel problème rencontrez-vous ?</h1>
        <p>Choisissez la situation la plus proche de votre besoin. Vous pourrez ajouter des précisions ensuite.</p>
        <PublicServiceList services={SERVICES} />
      </div>
    </PublicChrome>
  );
}
