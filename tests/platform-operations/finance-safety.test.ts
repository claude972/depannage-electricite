// Finance safety (ROOT mission): F1 admin text points to the real finance space; F2 no invented
// preview amount; F3 explicit confirmation with a frozen payload for invoice / credit note /
// commission rate, idempotent request_id kept; F4 ledger basis allowlist, provider ids hidden.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as View from "../../components/features/platform-operations/platform-finance-view";

const { money } = loadModule("components/features/platform-operations/shared.tsx") as { money: (c: number) => string };
const view = loadModule("components/features/platform-operations/platform-finance-view.tsx") as unknown as typeof View;
const src = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
const admin = readFileSync("components/role/admin-space.tsx", "utf8");
const render = (node: unknown) => renderToString(node as never).replaceAll("<!-- -->", "");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const PAY = "30000000-0000-4000-8000-000000000031";

test("F1 : plus de « aucune facture… Stripe seule pièce » ; lien factuel vers l’espace Finance plateforme", () => {
  assert.doesNotMatch(admin, /aucune facture ni avoir n’est généré|seule pièce disponible|règlements Stripe ci-dessus font foi/);
  assert.match(admin, /<a href="#platform-finance">Factures, avoirs et registre : espace Finance plateforme<\/a>/);
});

test("F2 : prêt mais montants absents / non sûrs ⇒ erreur bloquante, pas d’« Émettre », jamais 0,00 €", () => {
  const ready = (preview: Record<string, unknown>) => render(createElement(view.ReadinessResult, { readiness: { ready: true, missing: [], preview } as never, paymentId: PAY, busy: false, onIssue() {}, onRecheck() {} }));
  for (const preview of [{}, { total_cents: null, tax_cents: 0, subtotal_cents: 0 }, { total_cents: 1.5, tax_cents: 0, subtotal_cents: 1 }, { total_cents: 2 ** 53, tax_cents: 0, subtotal_cents: 0 }, { total_cents: 0, tax_cents: 0, subtotal_cents: 0 }, { total_cents: "100", tax_cents: 0, subtotal_cents: 100 }]) {
    const html = ready(preview);
    assert.match(text(html), /Montants de l’aperçu indisponibles : vérifiez à nouveau\./, JSON.stringify(preview));
    assert.match(html, />Vérifier les conditions</);
    assert.doesNotMatch(html, />Émettre</);
    assert.doesNotMatch(text(html), /0,00/);
    assert.equal(view.previewAmounts(preview as never), null);
  }
  const ok = ready({ total_cents: 24000, tax_cents: 4000, subtotal_cents: 20000 });
  assert.match(ok, />Émettre</);
  for (const v of [24000, 4000, 20000]) assert.ok(text(ok).includes(money(v).replace(/\s+/g, " ")), money(v));
  assert.doesNotMatch(src, /preview\.\w+_cents \?\? 0/); // aucun montant substitué
  // Non prêt : motifs traduits, jamais d’« Émettre ».
  const missing = render(createElement(view.ReadinessResult, { readiness: { ready: false, missing: ["platform_issuer", "platform_commission_vat_rate"], preview: {} } as never, paymentId: PAY, busy: false, onIssue() {}, onRecheck() {} }));
  assert.match(text(missing), /Émission impossible.*émetteur plateforme non configuré.*taux de TVA de commission non configuré/);
  assert.doesNotMatch(missing, />Émettre</);
});

test("F3 : confirmation explicite, charge utile figée, cible exacte affichée ; annulée par toute modification", () => {
  const payload = { request_id: "10000000-0000-4000-8000-000000000001", basis: "service" as const, payment_id: PAY };
  const c = view.openConfirmation(payload, view.issueSummary("service", PAY, { total_cents: 24000, tax_cents: 4000, subtotal_cents: 20000 }))!;
  payload.payment_id = "changed"; // la source change après ouverture
  same(c.payload, { request_id: "10000000-0000-4000-8000-000000000001", basis: "service", payment_id: PAY });
  assert.ok(Object.isFrozen(c.payload));
  assert.throws(() => { (c.payload as { payment_id: string }).payment_id = "x"; });
  same(c.summary, ["Base : Prestation (émetteur : artisan)", `Paiement : ${PAY}`, `TTC ${money(24000)} · TVA ${money(4000)} · HT ${money(20000)}`]);
  const box = render(createElement(view.ConfirmBox, { title: "Confirmer l’émission de la facture", summary: c.summary, confirmLabel: "Confirmer l’émission", busy: false, onConfirm() {}, onCancel() {} }));
  assert.match(box, /role="alertdialog" aria-label="Confirmer l’émission de la facture"/);
  assert.match(text(box), new RegExp(`Paiement : ${PAY}`));
  assert.match(box, /data-finance-confirm-ok="">Confirmer l’émission</);
  // Les trois actions passent par une confirmation (aucun appel direct depuis le formulaire).
  for (const [command, label] of [["issueInvoice", "Confirmer l’émission"], ["issueCreditNote", "Confirmer l’avoir"], ["setSetting", "Confirmer le taux"]] as const) {
    const calls = [...src.matchAll(new RegExp(`ctx\\.client\\.command\\.${command}\\(`, "g"))].map((m) => m.index!);
    for (const at of calls) {
      const window = src.slice(Math.max(0, at - 600), at);
      if (command === "setSetting" && !/commission_bps|rateConfirm/.test(window)) continue; // émetteur : hors périmètre F3
      assert.ok(/onConfirm=\{\(\) => ctx\.act\(\(\) => ctx\.client\.command\./.test(src.slice(at - 60, at + 30)), `${command} uniquement depuis onConfirm`);
    }
    assert.match(src, new RegExp(`confirmLabel="${label}"`));
  }
  // Toute modification d’un champ annule la confirmation ouverte.
  assert.match(src, /const onInput = \(next: \{ basis\?: typeof basis; paymentId\?: string \}\) => \{ setConfirm\(null\);/);
  for (const setter of ["setInvoiceId", "setAmount", "setReason"]) assert.match(src, new RegExp(`const ${setter} = \\(v: string\\) => \\{ setConfirm\\(null\\);`));
  assert.match(src, /const setBps = \(v: string\) => \{ setRateConfirm\(null\);/);
  // request_id : celui du formulaire (même clé en cas de nouvel essai) ; renouvelé seulement après succès.
  for (const form of ["issueInvoice", "issueCreditNote"]) {
    const at = src.indexOf(`ctx.client.command.${form}({ ...confirm.payload })`);
    assert.ok(at > 0, form);
    assert.match(src.slice(at, at + 260), /setRequestId\(newRequestId\(\)\)/);
  }
  assert.match(src, /openConfirmation\(\{ request_id: requestId, basis: bound\.basis, payment_id: bound\.payment_id \}/);
  assert.match(src, /openConfirmation\(\{ request_id: requestId, invoice_id, amount_cents: cents\.cents, reason: reason\.trim\(\) \}/);
});

test("F4 : base du registre = clés métier autorisées en français ; inconnues comptées ; aucun identifiant fournisseur", () => {
  const r = view.ledgerBasisRows({ source: "payments", paid_at: "2026-11-01T10:00:00Z", quote_id: "10000000-0000-4000-8000-000000000099", rate_source: "platform_setting", bps: 1000, setting_version: 3, gross_cents: 24000, tax_included: true, provider_reference: "pi_123", session_id: "cs_live_abc", event_type: "checkout.session.completed", event_id: "evt_1", provider_status: "succeeded", mystery: "x" });
  same(r.rows.map((x) => x.label), ["Origine", "Réglé le", "Devis", "Origine du taux", "Taux", "Version du paramètre", "Montant de base", "TVA incluse"]);
  assert.equal(r.rows.find((x) => x.label === "Taux")!.value, "10.00 %");
  assert.equal(r.rows.find((x) => x.label === "Origine")!.value, "règlement enregistré");
  assert.equal(r.hidden, 6);
  const html = render(createElement(view.LedgerBasis, { basis: { source: "provider_event", provider_reference: "pi_123", session_id: "cs_live_abc", amount_cents: 500 } }));
  assert.match(text(html), /Origine : événement fournisseur confirmé/);
  assert.match(text(html), /2 autres détails non affichés/);
  assert.doesNotMatch(html, /pi_123|cs_live|provider_reference|session_id/);
  // Valeur inattendue d’une clé connue : non affichée brute.
  same(view.ledgerBasisRows({ source: "<script>", bps: "10" }), { rows: [], hidden: 2 });
  assert.doesNotMatch(src, /external_event_id && <div>/);
  assert.doesNotMatch(src, /Object\.entries\(e\.basis\)\.map/);
});
