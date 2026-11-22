"use client";
// Display of one category's indicative range from GET /api/public/indicative-prices (shared store,
// one read per page). Before the read or on failure: honest fallback wording, never a number.
import { useEffect, useLayoutEffect, useState } from "react";
import { COPY, REVIEW_COPY, displayFor, getPricesState, loadPrices, recordShown, subscribePrices, type PriceCategory, type PricesState } from "./model";

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
 *  « estimation non vérifiée » — never an old static amount presented as current. The RENDERED
 *  version is recorded for `scope` at commit (what the user actually saw). */
export function ReviewEstimate({ category, scope }: { category: PriceCategory; scope: string }) {
  const s = useIndicativePrices();
  const version = s.phase === "ready" && s.data ? s.data.version : null;
  useLayoutEffect(() => {
    recordShown(scope, version);
  });
  useEffect(() => () => recordShown(scope, null), [scope]);
  return (
    <strong data-review-estimate={s.phase} data-review-version={version ?? undefined}>
      {version !== null ? displayFor(s, category) : s.phase === "error" ? REVIEW_COPY.unverified : COPY.loading}
    </strong>
  );
}

/** A request already sent with a reserved version: never the current price. The range is shown only
 *  when the store holds that same (immutable) version; otherwise the honest version note. */
export function ReservedEstimate({ category, version }: { category: PriceCategory; version: number }) {
  const s = useIndicativePrices();
  const same = s.phase === "ready" && s.data && s.data.version === version;
  return (
    <strong data-reserved-estimate={version}>
      {same ? displayFor(s, category) : REVIEW_COPY.reserved(version)}
    </strong>
  );
}
