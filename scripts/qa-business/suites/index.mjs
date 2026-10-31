// Suite registry of QA-DOCUMENTS-B2B-004. Each suite exports { name, description, needsCredentials, plan, run(ctx) }.
import { suite as docs } from "./docs.mjs";
import { suite as b2b } from "./b2b.mjs";

export const SUITES = [docs, b2b];

export function suiteByName(name) {
  const found = SUITES.find((s) => s.name === name);
  if (!found) throw new Error(`unknown suite ${name}`);
  return found;
}
