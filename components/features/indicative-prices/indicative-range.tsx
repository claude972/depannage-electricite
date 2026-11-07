"use client";
// Display of one category's indicative range from GET /api/public/indicative-prices (shared store,
// one read per page). Before the read or on failure: honest fallback wording, never a number.
import { useEffect, useState } from "react";
import { COPY, REVIEW_COPY, displayFor, getPricesState, loadPrices, subscribePrices, type PriceCategory, type PricesState } from "./model";

export function useIndicativePrices(): PricesState {
  const [s, setS] = useState<PricesState>(() => getPricesState());
  useEffect(() => {
    const off = subscribePrices(setS);
    setS(getPricesState());
    void loadPrices();
    return off;
  }, []);
  return s;
}

/** « Estimation indicative : 150 € – 250 € » (or the fallback); `bare` drops the label. */
export function IndicativeRange({ category, bare = false }: { category: PriceCategory; bare?: boolean }) {
  const s = useIndicativePrices();
  const text = displayFor(s, category);
  return (
    <span data-indicative-range={category} data-indicative-state={s.phase}>
      {bare ? text : `${COPY.label} : ${text}`}
    </span>
  );
}

/** Text form for props that take a string (same rule). */
export function useIndicativeText(category: PriceCategory): string {
  return displayFor(useIndicativePrices(), category);
}

/** Live review step: the range of the version the request will be reviewed against, or
 *  « estimation non vérifiée » — never an old static amount presented as current. */
export function ReviewEstimate({ category }: { category: PriceCategory }) {
  const s = useIndicativePrices();
  return (
    <strong data-review-estimate={s.phase} data-review-version={s.phase === "ready" && s.data ? s.data.version : undefined}>
      {s.phase === "ready" && s.data ? displayFor(s, category) : s.phase === "error" ? REVIEW_COPY.unverified : COPY.loading}
    </strong>
  );
}
