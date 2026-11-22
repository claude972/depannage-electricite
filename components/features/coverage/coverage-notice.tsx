"use client";
// CLI-03: informative notice when the intervention's postal code is NOT in the published coverage,
// or — client audience only (default wording, not cached) — when it is in the zone but no approved,
// available artisan serves it today (second GET, server-side yes/no, no identity or count).
// Nothing stored; silent on unknown / covered-and-served / failure.
// It never blocks a request and never promises (or excludes) an artisan.
import { useEffect, useState } from "react";
import { noArtisanNotice, notCoveredNotice, readCoverageSignal, readNotCovered, readNotCoveredCached, type CoverageSignal } from "./model";

export function CoverageNotice({ postalCode, fetcher, message = notCoveredNotice, cached = false }: { postalCode: string; fetcher?: typeof fetch; /** Wording for another audience (same verified « not_covered » fact). */ message?: (code: string) => string; /** Reuse a recent verified answer for the same code (lists of saved codes). */ cached?: boolean }) {
  const code = postalCode.trim();
  const [signal, setSignal] = useState<{ code: string; kind: CoverageSignal }>({ code: "", kind: null });
  // The availability signal is for the person filing / following a request, not for an artisan
  // declaring a zone (custom wording, cached list of saved codes).
  const clientAudience = message === notCoveredNotice && !cached;
  useEffect(() => {
    let active = true;
    const f = fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    const read: Promise<CoverageSignal> = clientAudience
      ? readCoverageSignal(f, code)
      : (cached ? readNotCoveredCached : readNotCovered)(f, code).then((yes) => (yes ? "not_covered" : null));
    void read.then((kind) => {
      if (active) setSignal({ code, kind });
    });
    return () => {
      active = false;
    };
  }, [code, fetcher, cached, clientAudience]);
  if (signal.code !== code || !signal.kind) return null;
  return (
    <p className="alert warning" role="status" data-coverage-notice={signal.kind}>
      <span>{signal.kind === "no_artisan" ? noArtisanNotice(code) : message(code)}</span>
    </p>
  );
}
