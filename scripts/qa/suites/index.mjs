// Suite registry. Each suite exports { name, description, needsCredentials, plan, run(ctx) }.
// ctx = { base, target, projectRef, fixtures, db, browser, cohort, out, report, redactor, log,
//         credentials, timeoutMs }.
import { suite as viewerSiteGrants } from "./viewer-site-grants.mjs";
import { suite as supportStaleAB } from "./support-stale-a-b.mjs";
import { suite as supportLostResponse } from "./support-lost-response.mjs";
import { suite as quoteDraft } from "./quote-draft.mjs";
import { suite as photosRecovery } from "./photos-recovery.mjs";
import { suite as adminOldDossiers } from "./admin-old-dossiers.mjs";
import { suite as captures } from "./captures.mjs";

export const SUITES = [viewerSiteGrants, supportStaleAB, supportLostResponse, quoteDraft, photosRecovery, adminOldDossiers, captures];

export function suiteByName(name) {
  const found = SUITES.find((s) => s.name === name);
  if (!found) throw new Error(`unknown suite ${name}`);
  return found;
}
