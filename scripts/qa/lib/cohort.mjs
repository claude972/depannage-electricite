// Cohort naming: every created identity, record and marker carries the run id so a human can
// recognise the run. The cohort marker is NEVER a deletion criterion; cleanup uses manifest ids.
import { randomBytes, randomUUID } from "node:crypto";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_DOMAIN = "qa.invalid"; // reserved TLD: undeliverable by construction

export function newRunId() {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

export function newPassword() {
  // 32 random bytes, plus classes required by common policies. Never written to disk.
  return "Qa!" + randomBytes(32).toString("base64url") + "aA1";
}

export function createCohort(runId = newRunId()) {
  if (!/^[0-9a-f]{12}$/.test(runId)) throw new Error("run id must be 12 hex characters");
  const marker = `QA-${runId.toUpperCase()}`;
  const slug = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    runId,
    marker,
    email: (label) => `qa-${runId}-${slug(label)}@${EMAIL_DOMAIN}`,
    fullName: (label) => `QA ${runId.toUpperCase()} ${label}`.slice(0, 120),
    name: (label) => `${marker} ${label}`.slice(0, 160),
    description: (text) => `${marker} ${text}`.slice(0, 4000),
    /** True when a free-text value visibly belongs to this cohort (display/diagnostic only). */
    belongs: (value) => typeof value === "string" && (value.includes(marker) || value.includes(`qa-${runId}-`)),
  };
}

export const isUuid = (value) => typeof value === "string" && UUID.test(value);
