import { enrichAcceptedTotals, AcceptedTotalsUnavailable } from "@/lib/features/workspace/accepted-totals";
import { authenticatedClient, apiError, dbError } from "@/lib/supabase/server";
import { DetailReadUnavailable, workspaceWindow } from "@/lib/features/workspace/detail-read";
import { clientWorkspaceCounters } from "@/lib/features/client-interventions/contract";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { db, user } = await authenticatedClient();
    const [
      profile,
      jobs,
      quotes,
      sites,
      organizations,
      messages,
      documents,
      reviews,
      payments,
      members,
      artisanProfile,
    ] = await Promise.all([
      db
        .from("profiles")
        .select("id,role,full_name,first_name,last_name,phone,artisan_approved,created_at")
        .eq("id", user.id)
        .single(),
      db
        .from("interventions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(101),
      db
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(201),
      db
        .from("sites")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(101),
      db.from("organizations").select("*").limit(51),
      db
        .from("messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("documents")
        .select("id,intervention_id,owner_id,name,mime_type,created_at")
        .limit(100),
      db.from("reviews").select("*").limit(100),
      db
        .from("payments")
        .select("id,quote_id,total_cents,currency,status,created_at,paid_at,method")
        .limit(100),
      db.from("organization_members").select("organization_id,user_id,role").limit(500),
      db.from("artisan_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    for (const response of [
      profile,
      jobs,
      quotes,
      sites,
      organizations,
      messages,
      documents,
      reviews,
      payments,
      members,
      artisanProfile,
    ])
      dbError(response.error);
    const jobWindow = workspaceWindow(jobs.data, 100);
    const quoteWindow = workspaceWindow(quotes.data, 200);
    const enrichedQuotes = await enrichAcceptedTotals(db, quoteWindow.rows);
    const siteWindow = workspaceWindow(sites.data, 100);
    const orgWindow = workspaceWindow(organizations.data, 50);
    const [offers, counters] = await Promise.all([
      profile.data?.role === "artisan" ? db.rpc("available_missions") : { data: [], error: null },
      profile.data?.role === "client" ? Promise.resolve(db.rpc("client_workspace_counters")).catch(() => null) : null,
    ]);
    dbError(offers.error);
    // Optional counters must not turn a dashboard read failure into an inaccessible workspace.
    const clientCounts = counters && !counters.error ? clientWorkspaceCounters.safeParse(counters.data) : null;
    // Latest saved appointments only for dossiers already readable/loaded in this response.
    // Unassigned offers never gain an address, note or participant through this projection.
    const loadedIds = jobWindow.rows.map(job => job.id);
    const appointments = loadedIds.length
      ? await db.from("intervention_appointments")
          .select("intervention_id,starts_at,ends_at,note,updated_by,updated_at", { count: "exact" })
          .in("intervention_id", loadedIds)
          .order("starts_at", { ascending: true }).order("intervention_id").limit(200)
      : { data: [], error: null, count: 0 };
    dbError(appointments.error);
    return Response.json(
      {
        profile: profile.data,
        ...(clientCounts?.success ? { client_counts: clientCounts.data } : {}),
        interventions: [...jobWindow.rows, ...(offers.data ?? [])],
        quotes: enrichedQuotes,
        sites: siteWindow.rows,
        organizations: orgWindow.rows,
        limits: {
          interventions: { limit: 100, limited: jobWindow.limited },
          quotes: { limit: 200, limited: quoteWindow.limited },
          sites: { limit: 100, limited: siteWindow.limited },
          organizations: { limit: 50, limited: orgWindow.limited },
        },
        messages: [...(messages.data ?? [])].reverse(),
        documents: documents.data,
        reviews: reviews.data,
        payments: payments.data,
        organization_members: members.data,
        artisan_profile: artisanProfile.data,
        appointments: appointments.data,
        appointments_limit: 200,
        appointments_limited: (appointments.count ?? 0) > 200,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof DetailReadUnavailable || error instanceof AcceptedTotalsUnavailable)
      return Response.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "2" } });
    return apiError(error);
  }
}
