"use client";
// ART-07 — live « Devis »: the paged list plus the exact point read of one quote. The list stays
// mounted (hidden) while a quote is open, so its pages and filter survive « Retour à la liste ».
import { useRef, useState } from "react";
import { ArtisanQuotesPanel } from "./artisan-quotes-panel";
import { ArtisanQuoteDetail } from "./artisan-quote-detail";
import type { Context } from "./model";
import styles from "./artisan-quotes.module.css";

export function ArtisanQuotes({ context, onOpenDossier, fetcher }: { context: Context; onOpenDossier: (interventionId: string) => void; fetcher?: typeof fetch }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<string | null>(null);
  const back = () => {
    const id = opener.current;
    setOpenId(null);
    // Focus returns to the row's « Ouvrir le devis » once the list is visible again.
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-quote-open="${id}"]`)?.focus());
  };
  return (
    <>
      {openId && <ArtisanQuoteDetail key={openId} context={context} quoteId={openId} onBack={back} onOpenDossier={onOpenDossier} fetcher={fetcher} />}
      <div hidden={openId !== null}>
        <ArtisanQuotesPanel
          context={context}
          onOpenDossier={onOpenDossier}
          fetcher={fetcher}
          rowAction={(q) => (
            <button
              type="button"
              className={styles.button}
              data-quote-open={q.id}
              onClick={() => {
                opener.current = q.id;
                setOpenId(q.id);
              }}
            >
              Ouvrir le devis
            </button>
          )}
        />
      </div>
    </>
  );
}
