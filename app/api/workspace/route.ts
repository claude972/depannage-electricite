import { authenticatedClient, apiError, dbError } from "@/lib/supabase/server";
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
        .select("id,role,full_name,phone,artisan_approved,created_at")
        .eq("id", user.id)
        .single(),
      db
        .from("interventions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("quotes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("sites")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("organizations").select("*").limit(50),
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
        .select("id,quote_id,total_cents,currency,status,created_at,paid_at")
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
    const offers =
      profile.data?.role === "artisan"
        ? await db.rpc("available_missions")
        : { data: [], error: null };
    dbError(offers.error);
    // Latest saved appointments only for dossiers already readable/loaded in this response.
    // Unassigned offers never gain an address, note or participant through this projection.
    const loadedIds = (jobs.data ?? []).map((job: { id: string }) => job.id);
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
        interventions: [...(jobs.data ?? []), ...(offers.data ?? [])],
        quotes: quotes.data,
        sites: sites.data,
        organizations: organizations.data,
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
    return apiError(error);
  }
}
