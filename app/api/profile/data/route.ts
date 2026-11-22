import { z } from "zod";
import {
  authenticatedClient,
  ApiError,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { parseBookingLocation } from "@/shared/booking-location";

import {requestSchema,checked,publicRequest,checkedPage} from "@/lib/features/data-requests/contracts";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const sections = z.enum(["account", "addresses", "requests", "booking_locations", "messages", "documents", "support", "erasure_requests", "payment_reminders"]);
const pageSize = 100;
const bookingLocationRows = z.array(z.object({
  id: uuid,
  actor_id: uuid,
  intervention_id: uuid.nullable(),
  location: z.unknown(),
}).strict()).max(pageSize + 1);
const records = {
  addresses: {
    table: "client_addresses",
    owner: "user_id",
    fields: "id,user_id,label,first_name,last_name,address,postal_code,city,country_code,latitude,longitude,geo_source,is_preferred,created_at,updated_at,archived_at",
  },
  requests: {
    table: "interventions",
    owner: "client_id",
    fields: "id,client_id,site_id,category,description,address,postal_code,city,urgency,status,created_at,updated_at",
  },
  messages: {
    table: "messages",
    owner: "author_id",
    fields: "id,author_id,intervention_id,body,created_at",
  },
  documents: {
    table: "documents",
    owner: "owner_id",
    fields: "id,owner_id,intervention_id,name,mime_type,created_at",
  },
  support: {
    table: "support_tickets",
    owner: "creator_id",
    fields: "id,creator_id,intervention_id,subject,status,created_at,updated_at",
  },
} as const;
const accountFields = "id,full_name,phone,role,created_at";
const preferencesFields = "user_id,muted_kinds,email_enabled,sms_enabled,push_enabled,updated_at";
const instant = z.iso.datetime({ offset: true });
const paymentReminderPage = z.object({
  rows: z.array(z.object({
    id: uuid,
    recipient_id: uuid,
    version: z.number().int().positive(),
    remind_at: instant,
    status: z.enum(["scheduled", "cancelled", "sent", "invalidated", "muted"]),
    processed_at: instant.nullable(),
  }).strict().refine(row => (row.status === "scheduled") === (row.processed_at === null))).max(pageSize),
  next_cursor: uuid.nullable(),
}).strict();
const erasure = z.object({
  action: z.literal("request_erasure"),
  request_id: uuid,
  confirmed: z.literal(true),
}).strict();
const ticketReceipt = z.object({request:requestSchema,ticket_id:uuid,status:z.enum(['open','in_progress','awaiting_user','resolved']),replayed:z.boolean()});

function projection(row: unknown, fields: string, ownerField: string, owner: string) {
  if (typeof row !== "object" || row === null || Array.isArray(row))
    throw new ApiError(503, "Les données reçues doivent être vérifiées.");
  const data = row as Record<string, unknown>;
  const keys = fields.split(",");
  if (data[ownerField] !== owner || keys.some((key) => !Object.hasOwn(data, key)))
    throw new ApiError(503, "Les données reçues doivent être vérifiées.");
  return Object.fromEntries(keys.map((field) => [field, data[field]]));
}

function failure(error: unknown) {
  const response = apiError(error);
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) {
      if ((key !== "section" && key !== "after") || query.getAll(key).length !== 1)
        throw new ApiError(422, "Paramètres de téléchargement invalides.");
    }
    const section = sections.safeParse(query.get("section") ?? "account");
    const after = uuid.nullable().safeParse(query.get("after"));
    if (!section.success || !after.success || (section.data === "account" && after.data))
      throw new ApiError(422, "Paramètres de téléchargement invalides.");

    if(section.data==='erasure_requests'){
      const result=await db.rpc('list_data_erasure_requests',{p_all:false,p_after:after.data,p_limit:100});dbError(result.error);
      return Response.json({section:section.data,...checkedPage(result.data,after.data,user.id)},{headers});
    }

    if (section.data === "booking_locations") {
      const result = await db.rpc("export_personal_booking_locations", { p_after: after.data });
      dbError(result.error);
      const page = checked(bookingLocationRows, result.data);
      let previous = after.data?.toLowerCase() ?? "";
      const rows = page.map(({ actor_id, id, intervention_id, location: rawLocation }) => {
        const location = parseBookingLocation(rawLocation);
        if (actor_id !== user.id || id <= previous || !location)
          throw new ApiError(503, "Les données reçues doivent être vérifiées.");
        previous = id;
        return { id, intervention_id, location };
      });
      return Response.json({
        section: section.data,
        rows: rows.slice(0, pageSize),
        next_cursor: rows.length > pageSize ? rows[pageSize - 1].id : null,
      }, { headers });
    }

    if (section.data === "payment_reminders") {
      const result = await db.rpc("export_personal_payment_reminders", { p_after: after.data });
      dbError(result.error);
      const page = checked(paymentReminderPage, result.data);
      let previous = after.data?.toLowerCase() ?? "";
      const rows = page.rows.map(({ recipient_id, ...row }) => {
        if (recipient_id !== user.id || row.id <= previous) {
          throw new ApiError(503, "La portée du téléchargement doit être vérifiée.");
        }
        previous = row.id;
        return row;
      });
      if (page.next_cursor !== null && (rows.length !== pageSize || page.next_cursor !== previous)) {
        throw new ApiError(503, "Les données reçues doivent être vérifiées.");
      }
      return Response.json({ section: section.data, rows, next_cursor: page.next_cursor }, { headers });
    }

    if (section.data === "account") {
      const [profile, preferences] = await Promise.all([
        db.from("profiles").select(`${accountFields},first_name,last_name`).eq("id", user.id).single(),
        db.from("notification_preferences").select(preferencesFields)
          .eq("user_id", user.id).maybeSingle(),
      ]);
      dbError(profile.error);
      dbError(preferences.error);
      const account = projection(profile.data, accountFields, "id", user.id);
      const given = profile.data?.first_name, family = profile.data?.last_name;
      if (typeof given === "string" && typeof family === "string") {
        account.first_name = given;
        account.last_name = family;
      }
      return Response.json({
        section: section.data,
        data: {
          email: user.email ?? null,
          verified_phone: user.phone_confirmed_at ? user.phone ?? null : null,
          profile: account,
          notification_preferences: preferences.data === null ? null :
            projection(preferences.data, preferencesFields, "user_id", user.id),
        },
        next_cursor: null,
      }, { headers });
    }

    const config = records[section.data];
    let selection = db.from(config.table).select(config.fields).eq(config.owner, user.id);
    if (section.data === "requests") selection = selection.is("site_id", null);
    if (after.data) selection = selection.gt("id", after.data);
    const result = await selection.order("id").limit(pageSize + 1);
    dbError(result.error);
    if (!Array.isArray(result.data) || result.data.length > pageSize + 1)
      throw new ApiError(503, "Les données reçues doivent être vérifiées.");

    const rows = result.data.slice(0, pageSize)
      .map((row) => projection(row, config.fields, config.owner, user.id));
    let previous = after.data?.toLowerCase() ?? "";
    for (const row of rows) {
      if (!uuid.safeParse(row.id).success || String(row.id) <= previous ||
          (section.data === "requests" && row.site_id !== null))
        throw new ApiError(503, "Les données reçues doivent être vérifiées.");
      previous = String(row.id);
    }
    return Response.json({
      section: section.data,
      rows,
      next_cursor: result.data.length > pageSize ? previous : null,
    }, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient(request);
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, erasure);
    const result = await db.rpc("create_data_erasure_request", {p_request_id: input.request_id});
    dbError(result.error);
    const receipt = checked(ticketReceipt,result.data);
    if(receipt.request.account_id!==user.id||receipt.ticket_id!==receipt.request.ticket_id)
      throw new ApiError(503,"Vérifiez votre demande avant de réessayer.");
    return Response.json({ticket_id:receipt.ticket_id,status:receipt.status,replayed:receipt.replayed,request:publicRequest(receipt.request)},{headers});
  } catch (error) {
    return failure(error);
  }
}
