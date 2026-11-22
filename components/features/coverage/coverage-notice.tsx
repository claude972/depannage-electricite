"use client";
// CLI-03: informative notice when the intervention's postal code is NOT in the published coverage.
// One GET per postal code (public contract), nothing stored; silent on unknown / covered / failure.
// It never blocks a request and never promises (or excludes) an artisan.
import { useEffect, useState } from "react";
import { notCoveredNotice, readNotCovered, readNotCoveredCached } from "./model";

export function CoverageNotice({ postalCode, fetcher, message = notCoveredNotice, cached = false }: { postalCode: string; fetcher?: typeof fetch; /** Wording for another audience (same verified « not_covered » fact). */ message?: (code: string) => string; /** Reuse a recent verified answer for the same code (lists of saved codes). */ cached?: boolean }) {
  const code = postalCode.trim();
  const [notCovered, setNotCovered] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (cached ? readNotCoveredCached : readNotCovered)(fetcher ?? ((...a) => fetch(...a)), code).then((yes) => {
      if (active) setNotCovered(yes ? code : null);
    });
    return () => {
      active = false;
    };
  }, [code, fetcher, cached]);
  if (notCovered !== code) return null;
  return (
    <p className="alert warning" role="status" data-coverage-notice="not_covered">
      <span>{message(code)}</span>
    </p>
  );
}
