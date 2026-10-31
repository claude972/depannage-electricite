import { z } from "zod";
import {
  authenticatedClient,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set_approval_rule"),
      site_id: uuid,
      threshold_cents: z.number().int().min(0).max(100000000),
      required_role: z.enum(["owner", "manager"]),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide_approval"),
      approval_id: uuid,
      decision: z.enum(["approved", "rejected"]),
      note: z.string().trim().max(2000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("save_contract"),
      id: uuid.optional(),
      organization_id: uuid,
      title: z.string().trim().min(1).max(160),
      reference: z.string().trim().max(160).default(""),
      starts_on: date,
      ends_on: date.nullish(),
      terms: z.string().max(8000).default(""),
      status: z.enum(["draft", "active", "archived"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("save_compliance"),
      id: uuid.optional(),
      site_id: uuid,
      title: z.string().trim().min(1).max(160),
      kind: z.enum(["audit", "maintenance", "safety", "equipment", "contract"]),
      due_on: date,
      status: z.enum(["pending", "scheduled", "completed"]),
      notes: z.string().max(4000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_site_budget"),
      site_id: uuid,
      budget_cents: z.number().int().min(0).max(100000000),
    })
    .strict(),
]);
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    const results = await Promise.all([
      db.from("approval_rules").select("*").limit(200),
      db
        .from("approvals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("contracts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("compliance_records")
        .select("*")
        .order("due_on", { ascending: true })
        .limit(300),
      db
        .from("professional_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    for (const result of results) dbError(result.error);
    return Response.json(
      {
        approval_rules: results[0].data,
        approvals: results[1].data,
        contracts: results[2].data,
        compliance_records: results[3].data,
        audit: results[4].data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const input = await validated(request, schema);
    let response;
    switch (input.action) {
      case "set_approval_rule":
        response = await db.rpc("set_approval_rule", {
          p_site_id: input.site_id,
          p_threshold_cents: input.threshold_cents,
          p_required_role: input.required_role,
          p_enabled: input.enabled,
        });
        break;
      case "decide_approval":
        response = await db.rpc("decide_approval", {
          p_approval_id: input.approval_id,
          p_decision: input.decision,
          p_note: input.note,
        });
        break;
      case "save_contract":
        response = await db.rpc("save_contract", {
          p_organization_id: input.organization_id,
          p_title: input.title,
          p_reference: input.reference,
          p_starts_on: input.starts_on,
          p_ends_on: input.ends_on || null,
          p_terms: input.terms,
          p_status: input.status,
          p_id: input.id ?? null,
        });
        break;
      case "save_compliance":
        response = await db.rpc("save_compliance", {
          p_site_id: input.site_id,
          p_title: input.title,
          p_kind: input.kind,
          p_due_on: input.due_on,
          p_status: input.status,
          p_notes: input.notes,
          p_id: input.id ?? null,
        });
        break;
      case "set_site_budget":
        response = await db.rpc("set_site_budget", {
          p_site_id: input.site_id,
          p_budget_cents: input.budget_cents,
        });
        break;
    }
    dbError(response.error);
    return Response.json({ result: response.data });
  } catch (error) {
    return apiError(error);
  }
}
