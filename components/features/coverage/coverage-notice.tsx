"use client";
// CLI-03: informative notice when the intervention's postal code is NOT in the published coverage.
// One GET per postal code (public contract), nothing stored; silent on unknown / covered / failure.
// It never blocks a request and never promises (or excludes) an artisan.
import { useEffect, useState } from "react";
import { notCoveredNotice, readNotCovered } from "./model";

export function CoverageNotice({ postalCode, fetcher }: { postalCode: string; fetcher?: typeof fetch }) {
  const code = postalCode.trim();
  const [notCovered, setNotCovered] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void readNotCovered(fetcher ?? ((...a) => fetch(...a)), code).then((yes) => {
      if (active) setNotCovered(yes ? code : null);
    });
    return () => {
      active = false;
    };
  }, [code, fetcher]);
  if (notCovered !== code) return null;
  return (
    <p className="alert warning" role="status" data-coverage-notice="not_covered">
      <span>{notCoveredNotice(code)}</span>
    </p>
  );
}
