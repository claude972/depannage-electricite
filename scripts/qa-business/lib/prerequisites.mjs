// Scenario prerequisites and targeted status classification (contract §16).
import { isUuid } from "../../qa/lib/cohort.mjs";

/** Names of the prerequisites that are not established; `checks` = {name: value|predicate-result}. */
export function missingPrerequisites(checks) {
  return Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}
export const isId = (value) => isUuid(value);

/**
 * Runs `fn` as a scenario only when every prerequisite holds; otherwise records the scenario as
 * BLOCKED ("prerequisite not established"), never PASS/FAIL, and `fn` is never called — so no
 * request is built with an undefined id (no `/api/…/undefined`, no 422 cascade).
 */
export async function scenarioWhen(report, suite, name, checks, fn) {
  const missing = missingPrerequisites(checks);
  if (missing.length) return report.blocked(suite, name, `prerequisite not established: ${missing.join(", ")} (an earlier scenario did not produce it); not proven by this run`);
  return report.scenario(suite, name, fn);
}

/**
 * Whether the client page states the quote as ACCEPTED, from the real status elements only:
 * QuoteView state note (`p.form-note` starting with « Devis accepté ») and the status tag of the
 * quote card in the documents panel (« Accepté »). Informational sentences elsewhere in the page
 * (« Le devis accepté devient la base du règlement… ») are not status elements.
 */
export function acceptedStatusShown({ formNotes = [], statusTags = [] }) {
  const notes = formNotes.map((t) => String(t).trim());
  const tags = statusTags.map((t) => String(t).trim());
  return notes.some((t) => /^Devis accepté(?=[\s.,]|$)/u.test(t)) || tags.some((t) => t === "Accepté");
}

/** Validity recorded in a stored document snapshot (015 quote_document_snapshot: `quote.terms`). */
export function snapshotValidUntil(snapshot) {
  const terms = snapshot?.quote?.terms;
  return terms && Object.prototype.hasOwnProperty.call(terms, "valid_until") ? terms.valid_until : undefined;
}
