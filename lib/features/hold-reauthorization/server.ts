import { env } from "node:process";
import { z } from "zod";
import {
  authenticatedClient,
  adminClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { cardHoldConfigured } from "@/lib/features/guest/payment-options";
import { appUrl } from "@/lib/supabase/stripe";
import {
  settlementProvider,
  qualifiedAccount,
  settlementLedger,
} from "@/lib/features/guest/settlement-provider";
import {
  Attempt,
  unavailable,
  conflict,
  tags,
  checkSession,
  reference,
  intentProof,
  newAuthorized,
  zeroProof,
  fresh,
  checkoutUrl,
  recoverSession,
} from "./provider";
const HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
type Admin = ReturnType<typeof adminClient>;
type Provider = ReturnType<typeof settlementProvider>;
async function rpc(
  db: { rpc: Function },
  name: string,
  args: Record<string, unknown>,
) {
  const r = await db.rpc(name, args);
  dbError(r.error);
  return r.data;
}
const attempt = z
  .object({
    id: uuid,
    intervention_id: uuid,
    actor_id: uuid,
    snapshot_id: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: z.record(z.string(), z.unknown()),
    old_ledger_id: uuid.nullable(),
    old_intent: z.string().regex(/^pi_[A-Za-z0-9]{1,200}$/),
    old_session: z.string().regex(/^cs_[A-Za-z0-9_]{1,240}$/),
    old_max: z.number().int().positive(),
    account_id: z.string().regex(/^acct_[A-Za-z0-9]{1,200}$/),
    fee_bps: z.number().int().min(-1).max(9999),
    fee_cents: z.number().int().min(-1),
    return_origin: z.string(),
    session_id: z
      .string()
      .regex(/^cs_[A-Za-z0-9_]{1,240}$/)
      .nullable(),
    intent_id: z
      .string()
      .regex(/^pi_[A-Za-z0-9]{1,200}$/)
      .nullable(),
    old_released: z.boolean(),
    status: z.enum([
      "opening",
      "awaiting_authorization",
      "new_authorized",
      "old_release_pending",
      "ready_for_capture",
      "aborting",
      "aborted",
      "needs_review",
    ]),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();
async function read(db: Admin, id: string, actor: string, job: string) {
  const parsed = attempt.safeParse(
    await rpc(db, "hold_reauthorization_private", { p_id: id, p_actor: actor }),
  );
  if (
    !parsed.success ||
    parsed.data.id !== id ||
    parsed.data.actor_id !== actor ||
    parsed.data.intervention_id !== job ||
    !uuid.safeParse(parsed.data.snapshot.quote_id).success ||
    !uuid.safeParse(parsed.data.snapshot.artisan_id).success ||
    !uuid.safeParse(parsed.data.snapshot.request_id).success ||
    !Number.isSafeInteger(parsed.data.snapshot.amount_cents) ||
    Number(parsed.data.snapshot.amount_cents) < 1
  )
    throw unavailable();
  return parsed.data as Attempt;
}
function response(a: Attempt, url?: string) {
  return Response.json(
    {
      status: a.status,
      attempt_id: a.id,
      intervention_id: a.intervention_id,
      currency: "eur",
      accepted_total_cents: a.snapshot.amount_cents,
      ...(url ? { url } : {}),
    },
    { status: url ? 200 : 202, headers: HEADERS },
  );
}
async function mark(db: Admin, a: Attempt) {
  await rpc(db, "review_hold_reauthorization", {
    p_id: a.id,
    p_actor: a.actor_id,
  });
}
async function account(p: Provider, a: Attempt) {
  if (!(await qualifiedAccount(p, a.account_id, String(a.snapshot.artisan_id))))
    throw conflict();
}
async function authorize(db: Admin, a: Attempt, action: string) {
  await rpc(db, "authorize_hold_reauthorization", {
    p_id: a.id,
    p_actor: a.actor_id,
    p_action: action,
  });
}
async function ensureSession(db: Admin, a: Attempt, p: Provider) {
  if (a.session_id)
    return checkSession(
      await p.stripe.checkout.sessions.retrieve(a.session_id!),
      a,
      p.live,
    );
  if (!fresh(a)) {
    const recovered = await recoverSession(p.stripe, a, p.live);
    if (!recovered) throw conflict();
    await rpc(db, "bind_hold_reauthorization", {
      p_id: a.id,
      p_actor: a.actor_id,
      p_session: recovered.id,
      p_intent: reference(recovered.payment_intent),
      p_authorized: false,
    });
    return recovered;
  }
  await account(p, a);
  const old = await intentProof(p.stripe, a, p.live, false);
  if (
    old.pi.amount_received !== 0 ||
    old.charge.amount_captured !== 0 ||
    old.charge.captured ||
    !["canceled", "requires_capture"].includes(old.pi.status)
  )
    throw conflict();
  if (a.snapshot.amount_cents <= a.old_max && old.pi.status !== "canceled")
    throw conflict();
  await authorize(db, a, "open");
  if (!fresh(a)) throw conflict();
  const s = checkSession(
    await p.stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        client_reference_id: String(a.snapshot.request_id),
        metadata: tags(a),
        payment_intent_data: { capture_method: "manual", metadata: tags(a) },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: a.snapshot.amount_cents,
              product_data: {
                name: "Nouvelle empreinte — total du devis et avenants acceptés",
              },
            },
          },
        ],
        expires_at: Math.floor(Date.parse(a.created_at) / 1000) + 24 * 3600,
        success_url: `${a.return_origin}/?hold_reauthorization=${a.id}&hold_return=success#detail/${a.intervention_id}`,
        cancel_url: `${a.return_origin}/?hold_reauthorization=${a.id}&hold_return=cancel#detail/${a.intervention_id}`,
      },
      { idempotencyKey: `hold-replacement:${a.id}` },
    ),
    a,
    p.live,
  );
  await rpc(db, "bind_hold_reauthorization", {
    p_id: a.id,
    p_actor: a.actor_id,
    p_session: s.id,
    p_intent: reference(s.payment_intent),
    p_authorized: false,
  });
  return s;
}
async function bindAuthorized(db: Admin, a: Attempt, p: Provider, s: any) {
  const pi = reference(s.payment_intent);
  if (s.status !== "complete" || !pi) throw conflict();
  a = { ...a, session_id: s.id, intent_id: pi };
  await newAuthorized(p.stripe, a, p.live);
  await account(p, a);
  await rpc(db, "bind_hold_reauthorization", {
    p_id: a.id,
    p_actor: a.actor_id,
    p_session: s.id,
    p_intent: pi,
    p_authorized: true,
  });
  return a;
}
async function cancelAndProve(
  db: Admin,
  a: Attempt,
  p: Provider,
  isNew: boolean,
) {
  let proof = await intentProof(p.stripe, a, p.live, isNew);
  if (proof.pi.status !== "canceled") {
    if (
      proof.pi.status !== "requires_capture" ||
      proof.pi.amount_received !== 0 ||
      proof.charge.amount_captured !== 0 ||
      proof.charge.captured
    ) {
      await mark(db, a);
      throw conflict();
    }
    if (!fresh(a)) throw conflict();
    if (!isNew) {
      await newAuthorized(p.stripe, a, p.live);
      await account(p, a);
    }
    await authorize(db, a, isNew ? "abort" : "release_old");
    if (!fresh(a)) throw conflict();
    await p.stripe.paymentIntents.cancel(
      proof.pi.id,
      {},
      { idempotencyKey: `hold-release:${a.id}:${isNew ? "new" : "old"}` },
    );
  }
  return zeroProof(p.stripe, a, p.live, isNew);
}
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("begin"),
      intervention_id: uuid,
      command_id: uuid,
      snapshot_id: z.string().regex(/^[a-f0-9]{64}$/),
      consent: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(["resume", "abort"]),
      intervention_id: uuid,
      attempt_id: uuid,
    })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, schema);
    if (!cardHoldConfigured(env))
      throw new ApiError(
        503,
        "La nouvelle autorisation bancaire n’est pas encore configurée.",
      );
    const p = settlementProvider(),
      admin = adminClient();
    let id: string;
    if (input.action === "begin") {
      id = await rpc(db, "begin_hold_reauthorization", {
        p_job: input.intervention_id,
        p_command: input.command_id,
        p_snapshot: input.snapshot_id,
      });
      if (id !== input.command_id) throw unavailable();
    } else id = input.attempt_id;
    let a = await read(admin, id, user.id, input.intervention_id);
    if (a.status === "aborted") return response(a);
    if (a.status === "needs_review") throw conflict();
    if (input.action === "abort") {
      await authorize(admin, a, "abort");
      a = await read(admin, id, user.id, input.intervention_id);
      if (a.session_id === null && a.fee_bps === -1) {
        await rpc(admin, "record_hold_session_expired", {
          p_id: id,
          p_actor: user.id,
          p_session: null,
        });
        return response(await read(admin, id, user.id, input.intervention_id));
      }
      // Recovery of an already-opened session is read-only; an unknown creation is retried with its SAME key.
      if (!a.session_id) {
        const recovered = await recoverSession(p.stripe, a, p.live);
        if (!recovered) throw conflict();
        await rpc(admin, "bind_hold_reauthorization", {
          p_id: id,
          p_actor: user.id,
          p_session: recovered.id,
          p_intent: reference(recovered.payment_intent),
          p_authorized: false,
        });
        a = await read(admin, id, user.id, input.intervention_id);
      }
      let s = checkSession(
        await p.stripe.checkout.sessions.retrieve(a.session_id!),
        a,
        p.live,
      );
      if (s.status === "open") {
        if (!fresh(a)) throw conflict();
        await authorize(admin, a, "abort");
        await p.stripe.checkout.sessions.expire(
          s.id,
          {},
          { idempotencyKey: `hold-expire:${a.id}` },
        );
        s = checkSession(
          await p.stripe.checkout.sessions.retrieve(s.id),
          a,
          p.live,
        );
      }
      const pi = reference(s.payment_intent);
      if (!pi) {
        if (s.status !== "expired") throw conflict();
        await rpc(admin, "record_hold_session_expired", {
          p_id: id,
          p_actor: user.id,
          p_session: s.id,
        });
      } else {
        await rpc(admin, "bind_hold_reauthorization", {
          p_id: id,
          p_actor: user.id,
          p_session: s.id,
          p_intent: pi,
          p_authorized: false,
        });
        a = { ...a, intent_id: pi };
        const proof = await cancelAndProve(admin, a, p, true);
        await rpc(admin, "record_hold_release", {
          p_id: id,
          p_actor: user.id,
          p_proof: proof,
          p_abort: true,
        });
      }
      return response(await read(admin, id, user.id, input.intervention_id));
    }
    if (a.fee_bps < 0) {
      const previous = a.old_ledger_id
        ? await settlementLedger(admin, a.old_ledger_id, a.actor_id)
        : null;
      const fee = previous?.fee_bps ?? p.fee;
      await account(p, a);
      await rpc(admin, "qualify_hold_reauthorization", {
        p_id: id,
        p_actor: user.id,
        p_account: a.account_id,
        p_fee: fee,
        p_origin: appUrl(),
      });
      a = await read(admin, id, user.id, input.intervention_id);
    }
    if (a.status === "ready_for_capture") {
      await newAuthorized(p.stripe, a, p.live);
      await rpc(admin, "hold_reauthorization_source", {
        p_job: a.intervention_id,
        p_actor: a.actor_id,
      });
      return response(a);
    }
    if (a.status !== "old_release_pending") {
      const s = await ensureSession(admin, a, p);
      a = await read(admin, id, user.id, input.intervention_id);
      if (s.status === "open") {
        await rpc(admin, "hold_reauthorization_source", {
          p_job: a.intervention_id,
          p_actor: a.actor_id,
        });
        a = await read(admin, id, user.id, input.intervention_id);
        if (!["opening", "awaiting_authorization"].includes(a.status))
          throw conflict();
        return response(a, checkoutUrl(s));
      }
      a = await bindAuthorized(admin, a, p, s);
      a = await read(admin, id, user.id, input.intervention_id);
    }
    // Every old-release attempt first proves a fresh, uncaptured replacement and current recipient.
    await newAuthorized(p.stripe, a, p.live);
    await account(p, a);
    await authorize(admin, a, "release_old");
    const proof = await cancelAndProve(admin, a, p, false);
    await rpc(admin, "record_hold_release", {
      p_id: id,
      p_actor: user.id,
      p_proof: proof,
      p_abort: false,
    });
    await newAuthorized(p.stripe, a, p.live);
    await account(p, a);
    await rpc(admin, "adopt_hold_reauthorization", {
      p_id: id,
      p_actor: user.id,
    });
    return response(await read(admin, id, user.id, input.intervention_id));
  } catch (e) {
    const status =
      e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
    return Response.json(
      {
        error:
          e instanceof ApiError
            ? e.message
            : "La reprise doit être vérifiée. Aucune seconde capture n’a été lancée.",
      },
      {
        status,
        headers: {
          ...HEADERS,
          ...(status === 503 ? { "Retry-After": "2" } : {}),
        },
      },
    );
  }
}
export async function GET(request: Request) {
  try {
    const { user } = await authenticatedClient();
    const q = new URL(request.url).searchParams;
    if (
      [...q].length !== 1 ||
      !uuid.safeParse(q.get("intervention_id")).success
    )
      throw new ApiError(422, "Dossier invalide.");
    const job = q.get("intervention_id")!;
    const db = adminClient();
    const v = await rpc(db, "hold_reauthorization_source", {
      p_job: job,
      p_actor: user.id,
    });
    if (
      !v ||
      typeof v !== "object" ||
      typeof v.snapshot_id !== "string" ||
      !v.source ||
      v.source.actor_id !== user.id ||
      v.source.intervention_id !== job ||
      !Number.isSafeInteger(v.source.amount_cents) ||
      v.source.amount_cents < 1
    )
      throw unavailable();
    const configured = cardHoldConfigured(env);
    let status = v.attempt?.status ?? "eligible",
      reason = configured ? null : "configuration_required";
    if (v.source.job_status !== "completed") reason = "not_completed";
    if (
      v.capture_inflight ||
      (v.ledger &&
        (v.ledger.status !== "processing" ||
          v.ledger.charge_id !== null ||
          v.ledger.transfer_id !== null ||
          v.ledger.captured_at !== null ||
          v.ledger.transfer_started_at !== null))
    )
      reason = "manual_review";
    if (
      !["quote_exceeds_hold", "authorization_missing", null].includes(
        v.source.reason,
      )
    )
      reason = "manual_review";
    if (status === "needs_review") reason = "manual_review";
    if (
      !/^[a-f0-9]{64}$/.test(v.snapshot_id) ||
      !Number.isSafeInteger(v.source.authorized_max) ||
      v.source.authorized_max < 1 ||
      ![
        "eligible",
        "opening",
        "awaiting_authorization",
        "new_authorized",
        "old_release_pending",
        "ready_for_capture",
        "aborting",
        "aborted",
        "needs_review",
      ].includes(status)
    )
      throw unavailable();
    if (configured && !v.attempt && v.source.reason === null) {
      const a = {
        actor_id: user.id,
        snapshot: v.source,
        old_intent: v.source.intent_id,
        old_max: v.source.authorized_max,
      } as Attempt;
      try {
        await zeroProof(
          settlementProvider().stripe,
          a,
          settlementProvider().live,
          false,
        );
      } catch {
        reason = "authorization_unavailable";
      }
    }
    // GET may verify authorization state, but never creates/cancels/captures or writes any row.
    if (
      configured &&
      v.attempt?.session_id &&
      ["awaiting_authorization", "new_authorized"].includes(status)
    ) {
      const a = await read(db, v.attempt.id, user.id, job),
        p = settlementProvider(),
        s = checkSession(
          await p.stripe.checkout.sessions.retrieve(a.session_id!),
          a,
          p.live,
        );
      if (s.status === "complete" && reference(s.payment_intent)) {
        try {
          await newAuthorized(
            p.stripe,
            { ...a, intent_id: reference(s.payment_intent) },
            p.live,
          );
          status = "new_authorized";
        } catch {
          reason = "authorization_unavailable";
        }
      } else if (s.status === "expired") reason = "authorization_unavailable";
    }
    await rpc(db, "hold_reauthorization_source", {
      p_job: job,
      p_actor: user.id,
    });
    return Response.json(
      {
        status,
        reason,
        attempt_id: v.attempt?.id ?? null,
        snapshot_id: v.snapshot_id,
        accepted_total_cents: v.source.amount_cents,
        original_authorized_cents: v.source.authorized_max,
        replacement_authorized_cents: v.source.amount_cents,
        currency: "eur",
        available: reason === null,
        consent_required: true,
      },
      { headers: HEADERS },
    );
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 503;
    return Response.json(
      {
        error:
          e instanceof ApiError
            ? e.message
            : "Les autorisations doivent être vérifiées.",
      },
      {
        status,
        headers: {
          ...HEADERS,
          ...(status === 503 ? { "Retry-After": "2" } : {}),
        },
      },
    );
  }
}
