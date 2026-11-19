"use client";

import { useId, useRef, useState } from "react";
import { SUPPORT_CONTACT, supportContactHref } from "../../shared/support-contact";
import { Icon } from "../app/icons";
import { publishedValue } from "../features/public-operator-profile/model";
import { usePublishedOperatorProfile } from "../features/public-operator-profile/use-published-profile";
import styles from "./public-contact-actions.module.css";

type Channel = keyof typeof SUPPORT_CONTACT;
export function usePublishedSupportPhone() {
  const operator = usePublishedOperatorProfile(true);
  return supportContactHref("phone", publishedValue(operator, "public_phone"));
}

export function PublicContactActions({ phoneHref, whatsappPhone, inline = false, whatsappOnly = false, phoneLabel = SUPPORT_CONTACT.phone.label }: {
  phoneHref: string | null;
  whatsappPhone?: string;
  inline?: boolean;
  whatsappOnly?: boolean;
  phoneLabel?: string;
}) {
  const whatsappHref = supportContactHref("whatsapp", whatsappPhone);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [channel, setChannel] = useState<Channel>("phone");

  function showHelp(next: Channel) {
    setChannel(next);
    dialog.current?.showModal();
  }

  const phoneContent = <><Icon name="phone" size={19} /> {phoneLabel}</>;
  const callClass = inline ? styles.inlineCall : styles.call;
  const phoneAction = phoneHref
    ? <a className={callClass} href={phoneHref}>{phoneContent}</a>
    : <button type="button" className={callClass} onClick={() => showHelp("phone")}>{phoneContent}</button>;
  const whatsappIcon = <svg viewBox="0 0 24 24" width={23} height={23} aria-hidden="true"><use href="/brand/contact-whatsapp.svg#whatsapp-mark" /></svg>;

  return (
    <>
      {inline ? phoneAction : <div className={`${styles.actions} ${whatsappOnly ? styles.persistentWhatsapp : ""}`} role="group" aria-label="Contacter DomDépannage" data-floating-contact="" data-whatsapp-dock={whatsappOnly ? "" : undefined}>
        {!whatsappOnly && phoneAction}
        {whatsappHref
          ? <a className={styles.whatsapp} href={whatsappHref} aria-label={SUPPORT_CONTACT.whatsapp.label}>{whatsappIcon}</a>
          : <button type="button" className={styles.whatsapp} aria-label={SUPPORT_CONTACT.whatsapp.label} onClick={() => showHelp("whatsapp")}>{whatsappIcon}</button>}
      </div>}
      <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId}>
        <h2 id={titleId}>{SUPPORT_CONTACT[channel].label}</h2>
        <p>{SUPPORT_CONTACT[channel].unavailable}</p>
        <a href="/#help/contact" onClick={() => dialog.current?.close()}>Voir les options de contact</a>
        <form method="dialog"><button type="submit" aria-label="Fermer"><Icon name="close" size={20} /></button></form>
      </dialog>
    </>
  );
}
