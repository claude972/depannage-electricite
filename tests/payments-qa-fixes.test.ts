// QA paiements (recette, Stripe TEST) — correctifs de la couche Next/TS : détail du règlement côté
// artisan (ART-11), refus explicites, commission d’un règlement par empreinte au registre, référence
// et fuseau des factures PDF, préremplissage d’adresse depuis un site, lien de retour mobile.
import test from "node:test";
import assert from "node:assert/strict";
import { artisanSettlementFrom, readArtisanSettlement } from "../lib/features/payments/artisan-settlement";
import { artisanSettlementView, commissionRateLabel } from "../components/app/artisan-settlement";
import { checkoutDbError, CHECKOUT_ALREADY_SETTLED } from "../lib/features/payments/checkout";
import { financeWriteError, FINANCE_REFUSALS, platformMfaRefusal } from "../lib/features/platform-operations/mfa";
import { recordSettlementCommission, type Settlement } from "../lib/features/guest/settlement-provider";
import { formatDateTimeMartinique } from "../lib/features/quote-documents/format";
import { siteAddressParts } from "../components/app/site-address";
import { showsMobileAppReturn } from "../components/app/mobile-return";
import { payerMemberLabels } from "../components/features/delegated-payer/member-labels";
import { PLATFORM_COMMISSION_BPS } from "../shared/commercial-facts";

const paid = { status: "paid", total_cents: 13020, method: "stripe" };

test("ART-11 : le détail vient de l’instantané serveur du Checkout réglé (10 % figés), jamais d’un taux recalculé", () => {
  const s = artisanSettlementFrom(paid, { amount_cents: 13020, fee_bps: PLATFORM_COMMISSION_BPS, fee_cents: 1302, status: "paid" }, null);
  assert.deepEqual(s, { channel: "checkout", amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, net_cents: 11718, transfer: "with_payment" });
  // Montant différent du paiement confirmé, commission incohérente, Checkout non réglé ⇒ rien.
  assert.equal(artisanSettlementFrom(paid, { amount_cents: 13000, fee_bps: 1000, fee_cents: 1300, status: "paid" }, null), null);
  assert.equal(artisanSettlementFrom(paid, { amount_cents: 13020, fee_bps: 1000, fee_cents: 1000, status: "paid" }, null), null);
  assert.equal(artisanSettlementFrom(paid, { amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, status: "open" }, null), null);
  // Paiement non confirmé ou déclaré sur place ⇒ aucun détail.
  assert.equal(artisanSettlementFrom({ ...paid, status: "pending" }, { amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, status: "paid" }, null), null);
  assert.equal(artisanSettlementFrom({ ...paid, method: "on_site_declared" }, { amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, status: "paid" }, null), null);
});

test("ART-11 : règlement par empreinte ⇒ transfert « confirmé » seulement avec la référence de transfert enregistrée", () => {
  const guest = { amount_cents: 11104, fee_bps: 1000, fee_cents: 1110, transfer_cents: 9994, status: "paid", transfer_id: "tr_QA1" };
  assert.deepEqual(artisanSettlementFrom({ ...paid, total_cents: 11104 }, null, guest), { channel: "card_hold", amount_cents: 11104, fee_bps: 1000, fee_cents: 1110, net_cents: 9994, transfer: "confirmed" });
  assert.equal(artisanSettlementFrom({ ...paid, total_cents: 11104 }, null, { ...guest, transfer_id: null }), null);
  assert.equal(artisanSettlementFrom({ ...paid, total_cents: 11104 }, null, { ...guest, transfer_cents: 9000 }), null);
});

test("ART-11 : la lecture de service est bornée au devis et à l’artisan ; une lecture en échec ne donne rien", async () => {
  const seen: { table: string; filters: [string, string][] }[] = [];
  const admin = (rows: Record<string, unknown>) => ({ from(table: string) {
    const entry = { table, filters: [] as [string, string][] }; seen.push(entry);
    const q = { select: () => q, eq: (k: string, v: string) => { entry.filters.push([k, v]); return q; }, maybeSingle: async () => rows[table] instanceof Error ? { data: null, error: { code: "42501" } } : { data: rows[table] ?? null, error: null } };
    return q;
  } });
  const s = await readArtisanSettlement(admin({ platform_checkouts: { amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, status: "paid" } }), "Q", "A", paid);
  assert.equal(s?.net_cents, 11718);
  for (const call of seen) assert.deepEqual(call.filters, [["quote_id", "Q"], ["artisan_id", "A"], ["status", "paid"]]);
  assert.equal(await readArtisanSettlement(admin({ platform_checkouts: new Error("denied") }), "Q", "A", paid), null);
  seen.length = 0;
  assert.equal(await readArtisanSettlement(admin({}), "Q", "A", { ...paid, status: "failed" }), null);
  assert.equal(seen.length, 0, "aucune lecture pour un paiement non réglé");
});

test("ART-11 : libellés artisan — commission au taux figé, net, et aucun virement bancaire affirmé", () => {
  const v = artisanSettlementView({ channel: "checkout", amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, net_cents: 11718, transfer: "with_payment" });
  assert.ok(v);
  assert.equal(v.commissionLabel, "Commission plateforme (10 %)");
  assert.equal(v.netCents, 11718);
  assert.match(v.payout, /compte de règlement/);
  assert.match(v.payout, /la plateforme ne le confirme pas ici/);
  assert.doesNotMatch(v.payout, /versé sur votre compte bancaire|virement effectué/);
  const confirmed = artisanSettlementView({ channel: "card_hold", amount_cents: 11104, fee_bps: 1000, fee_cents: 1110, net_cents: 9994, transfer: "confirmed" });
  assert.match(confirmed!.payout, /confirmé par la plateforme/);
  assert.match(confirmed!.payout, /la plateforme ne le confirme pas ici/);
  assert.equal(commissionRateLabel(1250), "12,5 %");
  // Rapport incohérent ou état inconnu ⇒ rien d’affiché.
  assert.equal(artisanSettlementView({ channel: "checkout", amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, net_cents: 11000, transfer: "with_payment" }), null);
  assert.equal(artisanSettlementView({ channel: "checkout", amount_cents: 13020, fee_bps: 1000, fee_cents: 1302, net_cents: 11718, transfer: "paid_out" }), null);
  assert.equal(artisanSettlementView(undefined), null);
});

test("second Checkout sur un dossier réglé : « déjà réglé », pas « actualisez la page »", () => {
  assert.throws(() => checkoutDbError({ code: "P0001", message: "Payment already settled" }), (e: { status?: number; message: string }) => {
    assert.equal(e.status, 409);
    assert.equal(e.message, CHECKOUT_ALREADY_SETTLED);
    assert.match(e.message, /Ce dossier est déjà réglé\./);
    assert.doesNotMatch(e.message, /Actualisez/);
    return true;
  });
});

test("avoir au-delà du solde de la facture / remboursement au-delà du réglé : motif réel ; MFA et refus inconnus inchangés", () => {
  assert.throws(() => financeWriteError({ code: "P0001", message: "Credit notes exceed the invoice total" }), (e: { status?: number; message: string }) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /dépasse le solde restant de la facture/);
    assert.doesNotMatch(e.message, /Actualisez/);
    return true;
  });
  for (const reason of Object.keys(FINANCE_REFUSALS))
    assert.throws(() => financeWriteError({ code: "P0001", message: reason }), (e: { message: string }) => e.message === FINANCE_REFUSALS[reason]);
  assert.throws(() => financeWriteError({ code: "P0001", message: "Request key content conflict" }), /L’état du dossier a changé/);
  assert.throws(() => financeWriteError({ code: "PT403", message: "platform_mfa_required" }), (e: unknown) => platformMfaRefusal(e)?.code === "platform_mfa_required");
  assert.doesNotThrow(() => financeWriteError(null));
});

const settlement: Settlement = { id: "50000000-0000-4000-8000-000000000005", intervention_id: "20000000-0000-4000-8000-000000000002", actor_id: "10000000-0000-4000-8000-000000000001", quote_id: "30000000-0000-4000-8000-000000000003", artisan_id: "60000000-0000-4000-8000-000000000006", request_id: "40000000-0000-4000-8000-000000000004", intent_id: "pi_QA", session_id: "cs_test_QA", authorized_max: 18000, amount_cents: 11104, account_id: "acct_QA", fee_bps: 1000, transfer_cents: 9994, status: "paid", charge_id: "ch_QA", transfer_id: "tr_QA", created_at: "2026-11-21T10:00:00Z", transfer_started_at: "2026-11-21T10:00:05Z" };
function ledgerAdmin(options: { payment?: Record<string, unknown> | null; rpc?: () => { data: unknown; error: { code?: string; message?: string } | null } } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const payment = options.payment === undefined ? { id: "a9611189-0000-4000-8000-000000000000", status: "paid", session_id: "cs_test_QA", total_cents: 11104, currency: "eur" } : options.payment;
  const admin = {
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: payment, error: null }) }; return q; },
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return options.rpc ? options.rpc() : { data: true, error: null }; },
  };
  return { admin: admin as unknown as Parameters<typeof recordSettlementCommission>[0], calls };
}

test("empreinte bancaire : la commission retenue (réglé − transfert prouvé) est inscrite au registre, une seule fois", async () => {
  const f = ledgerAdmin();
  assert.equal(await recordSettlementCommission(f.admin, settlement), "recorded");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, "platform_record_commission_withheld");
  assert.deepEqual(f.calls[0].args, { p_payment_id: "a9611189-0000-4000-8000-000000000000", p_event_id: `guest-settlement-commission:${settlement.id}`, p_event_type: "guest_settlement.transfer_confirmed", p_session_id: "cs_test_QA", p_provider_reference: "tr_QA", p_provider_status: "succeeded", p_amount_cents: 1110, p_currency: "eur" });
  // Rejeu : la clé est le règlement lui-même ; « false » ou « Commission already recorded » ⇒ existant.
  assert.equal(await recordSettlementCommission(ledgerAdmin({ rpc: () => ({ data: false, error: null }) }).admin, settlement), "existing");
  assert.equal(await recordSettlementCommission(ledgerAdmin({ rpc: () => ({ data: null, error: { code: "P0001", message: "Commission already recorded" } }) }).admin, settlement), "existing");
});

test("empreinte bancaire : aucune écriture sans transfert prouvé, sans paiement concordant ou pour une commission nulle ; un refus n’est jamais une erreur du règlement", async () => {
  for (const l of [{ ...settlement, status: "captured_transfer_pending" }, { ...settlement, transfer_id: null }, { ...settlement, transfer_cents: 11104 }, { ...settlement, transfer_cents: null }]) {
    const f = ledgerAdmin();
    assert.equal(await recordSettlementCommission(f.admin, l), "skipped");
    assert.equal(f.calls.length, 0);
  }
  for (const payment of [null, { id: "p", status: "pending", session_id: "cs_test_QA", total_cents: 11104, currency: "eur" }, { id: "p", status: "paid", session_id: "cs_test_OTHER", total_cents: 11104, currency: "eur" }, { id: "p", status: "paid", session_id: "cs_test_QA", total_cents: 9999, currency: "eur" }]) {
    const f = ledgerAdmin({ payment });
    assert.equal(await recordSettlementCommission(f.admin, settlement), "skipped");
    assert.equal(f.calls.length, 0);
  }
  const error = console.error; console.error = () => undefined;
  try {
    assert.equal(await recordSettlementCommission(ledgerAdmin({ rpc: () => ({ data: null, error: { code: "P0001", message: "Commission event mismatch" } }) }).admin, settlement), "failed");
    assert.equal(await recordSettlementCommission(ledgerAdmin({ rpc: () => { throw new Error("network"); } }).admin, settlement), "failed");
  } finally { console.error = error; }
});

test("facture PDF : date d’émission à l’heure de Martinique (UTC−4, sans heure d’été)", () => {
  assert.equal(formatDateTimeMartinique("2026-11-22T03:43:00Z"), "21/11/2026 23:43 (heure de Martinique)");
  assert.equal(formatDateTimeMartinique("2026-07-01T12:00:00+02:00"), "01/07/2026 06:00 (heure de Martinique)");
  assert.equal(formatDateTimeMartinique("not a date"), "not a date");
  assert.equal(formatDateTimeMartinique(null), "");
});

test("demande entreprise : l’adresse du site choisi préremplit rue, code postal et ville sans rien inventer", () => {
  assert.deepEqual(siteAddressParts("12 rue des Ateliers, 97200 Fort-de-France"), { address: "12 rue des Ateliers", postal_code: "97200", city: "Fort-de-France" });
  assert.deepEqual(siteAddressParts("  Cité Eucalyptus 97240  Le François "), { address: "Cité Eucalyptus", postal_code: "97240", city: "Le François" });
  assert.deepEqual(siteAddressParts("Zone de Jambette\n97232 Le Lamentin"), { address: "Zone de Jambette", postal_code: "97232", city: "Le Lamentin" });
  // Sans code postal reconnaissable : seule la ligne d’adresse est préremplie.
  assert.deepEqual(siteAddressParts("Immeuble Astra, Fort-de-France"), { address: "Immeuble Astra, Fort-de-France", postal_code: "", city: "" });
  assert.equal(siteAddressParts(""), null);
  assert.equal(siteAddressParts(undefined), null);
});

test("retour de paiement : le lien vers l’application mobile n’apparaît pas sur un navigateur de bureau", () => {
  const desktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  assert.equal(showsMobileAppReturn(desktop, 1280), false);
  assert.equal(showsMobileAppReturn("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15", 390), true);
  assert.equal(showsMobileAppReturn("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36", 1024), true);
  assert.equal(showsMobileAppReturn(desktop, 390), true, "petit écran");
  assert.equal(showsMobileAppReturn(undefined, undefined), false);
});

test("payeur délégué : deux membres homonymes restent distinguables (rôle, puis référence courte)", () => {
  const roles = { owner: "Propriétaire", manager: "Gestionnaire", viewer: "Lecture" };
  const labels = payerMemberLabels([
    { user_id: "aaaaaaaa-0000-4000-8000-000000000001", full_name: "Audit Astra", role: "manager" },
    { user_id: "bbbbbbbb-0000-4000-8000-000000000002", full_name: "Audit Astra", role: "viewer" },
    { user_id: "cccccccc-0000-4000-8000-000000000003", full_name: "Audit Astra", role: "viewer" },
    { user_id: "dddddddd-0000-4000-8000-000000000004", full_name: "", role: "owner" },
  ], roles);
  assert.deepEqual(labels.map((l) => l.label), ["Audit Astra — Gestionnaire", "Audit Astra — Lecture (réf. bbbbbbbb)", "Audit Astra — Lecture (réf. cccccccc)", "Membre dddddddd — Propriétaire"]);
  assert.equal(new Set(labels.map((l) => l.label)).size, labels.length);
});
