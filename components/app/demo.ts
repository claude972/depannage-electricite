// Explicit, isolated demonstration data. Only ever read while mode === "demo"; the live
// session never touches these keys. All figures are examples, never real metrics.
import {
  EMPTY_PROFESSIONAL,
  EMPTY_WORKSPACE,
  type AdminOverview,
  type Appointment,
  type ArtisanDossier,
  type InterventionReport,
  type Participant,
  type ProfessionalData,
  type Profile,
  type TravelStage,
  type WarrantyCase,
  type Workspace,
} from "./types";

export const DEMO_KEYS = {
  workspace: "courant-demo-v3",
  professional: "courant-professional-demo-v1",
  admin: "courant-admin-demo-v1",
  warranty: "courant-warranty-demo-v1",
  operations: "courant-demo-operations-v1",
  artisan: "courant-demo-artisan-v1",
  invitations: "courant-demo-invitations-v1",
  siteAccess: "courant-demo-site-access-v1",
} as const;
export const DEMO_IDS = {
  client: "demo-client",
  artisan: "demo-artisan",
  artisan2: "demo-artisan-2",
  manager: "demo-manager",
  admin: "demo-admin",
} as const;
export const DEMO_NAMES = {
  client: "Camille Dupont",
  artisan: "Alex Martin",
  manager: "Camille Bernard",
  admin: "Opérateur démo",
} as const;

export function seed(): Workspace {
  return {
    ...EMPTY_WORKSPACE,
    organizations: [{ id: "org-demo", name: "Maison & lieux", type: "syndic" }],
    organization_members: [
      { organization_id: "org-demo", user_id: DEMO_IDS.manager, role: "owner" },
      { organization_id: "org-demo", user_id: "demo-viewer", role: "viewer" },
    ],
    appointments: [
      {
        intervention_id: "demo-004",
        starts_at: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(),
        ends_at: new Date(new Date().setHours(16, 0, 0, 0)).toISOString(),
        note: "Créneau d’exemple convenu avec le client (démonstration).",
        updated_by: DEMO_IDS.artisan,
        updated_at: "2026-10-30T08:50:00Z",
      },
    ],
    sites: [
      {
        id: "site-1",
        organization_id: "org-demo",
        name: "Résidence des Alizés",
        type: "syndic",
        address: "12 rue des Alizés, Fort-de-France",
        budget_cents: 500000,
      },
      {
        id: "site-2",
        organization_id: "org-demo",
        name: "Restaurant Le Patio",
        type: "restaurant",
        address: "8 rue du Marché, Fort-de-France",
        budget_cents: 300000,
      },
      {
        id: "site-3",
        organization_id: "org-demo",
        name: "Bureaux Bellevue",
        type: "office",
        address: "24 avenue Bellevue, Fort-de-France",
        budget_cents: 400000,
      },
    ],
    interventions: [
      {
        id: "demo-001",
        category: "panel",
        description:
          "Le disjoncteur du tableau se déclenche lorsque plusieurs appareils fonctionnent. Demande d’un diagnostic et de remise en service.",
        address: "12 rue des Alizés",
        postal_code: "97200",
        city: "Fort-de-France",
        urgency: "urgent",
        status: "quoted",
        created_at: "2026-10-30T09:30:00Z",
        estimate_min_cents: 15000,
        estimate_max_cents: 35000,
        artisan_id: DEMO_IDS.artisan,
        client_id: DEMO_IDS.client,
        site_id: "site-1",
        travel_stage: "planned",
      },
      {
        id: "demo-002",
        category: "socket",
        description:
          "Deux prises ne fonctionnent plus dans la salle principale.",
        address: "8 rue du Marché",
        postal_code: "97200",
        city: "Fort-de-France",
        urgency: "scheduled",
        status: "requested",
        created_at: "2026-10-29T11:00:00Z",
        estimate_min_cents: 8000,
        estimate_max_cents: 18000,
        client_id: DEMO_IDS.client,
        site_id: "site-2",
        travel_stage: "planned",
      },
      {
        id: "demo-003",
        category: "lighting",
        description:
          "Remplacement d’un point lumineux et vérification du circuit.",
        address: "24 avenue Bellevue",
        postal_code: "97200",
        city: "Fort-de-France",
        urgency: "scheduled",
        status: "paid",
        created_at: "2026-10-20T08:00:00Z",
        completed_at: "2026-10-21T16:00:00Z",
        paid_at: "2026-10-22T09:00:00Z",
        estimate_min_cents: 8000,
        estimate_max_cents: 20000,
        artisan_id: DEMO_IDS.artisan,
        client_id: DEMO_IDS.client,
        site_id: "site-3",
        travel_stage: "on_site",
      },
      {
        id: "demo-004",
        category: "diagnostic",
        description:
          "Odeur de brûlé intermittente près du compteur, aucun déclenchement constaté.",
        address: "5 impasse des Flamboyants",
        postal_code: "97200",
        city: "Fort-de-France",
        urgency: "urgent",
        status: "accepted",
        created_at: "2026-10-30T07:15:00Z",
        estimate_min_cents: 12000,
        estimate_max_cents: 28000,
        artisan_id: DEMO_IDS.artisan,
        client_id: DEMO_IDS.client,
        travel_stage: "planned",
      },
    ],
    quotes: [
      {
        id: "quote-demo-1",
        intervention_id: "demo-001",
        artisan_id: DEMO_IDS.artisan,
        lines: [
          { label: "Déplacement et diagnostic", quantity: 1, unit_price_cents: 6000 },
          { label: "Main-d’œuvre (forfait)", quantity: 1, unit_price_cents: 9000 },
          { label: "Fournitures électriques", quantity: 1, unit_price_cents: 3500 },
        ],
        subtotal_cents: 18500,
        tax_cents: 3700,
        total_cents: 22200,
        tax_rate: 20,
        status: "sent",
        created_at: "2026-10-30T10:00:00Z",
      },
      {
        id: "quote-demo-3",
        intervention_id: "demo-003",
        artisan_id: DEMO_IDS.artisan,
        lines: [
          {
            label: "Vérification et remplacement du luminaire",
            quantity: 1,
            unit_price_cents: 12000,
          },
        ],
        subtotal_cents: 12000,
        tax_cents: 2400,
        total_cents: 14400,
        tax_rate: 20,
        status: "accepted",
        created_at: "2026-10-20T10:00:00Z",
        accepted_at: "2026-10-20T15:00:00Z",
      },
      {
        id: "quote-demo-4",
        intervention_id: "demo-004",
        artisan_id: DEMO_IDS.artisan,
        lines: [
          { label: "Déplacement", quantity: 1, unit_price_cents: 5000 },
          { label: "Recherche de panne (2 h)", quantity: 2, unit_price_cents: 5500 },
        ],
        subtotal_cents: 16000,
        tax_cents: 3200,
        total_cents: 19200,
        tax_rate: 20,
        status: "accepted",
        created_at: "2026-10-30T08:00:00Z",
        accepted_at: "2026-10-30T08:40:00Z",
      },
    ],
    payments: [
      {
        id: "pay-demo-3",
        quote_id: "quote-demo-3",
        total_cents: 14400,
        currency: "eur",
        status: "paid",
        created_at: "2026-10-22T08:50:00Z",
        paid_at: "2026-10-22T09:00:00Z",
      },
    ],
    reviews: [
      {
        id: "review-demo-3",
        intervention_id: "demo-003",
        author_id: DEMO_IDS.client,
        rating: 5,
        body: "Intervention propre et explications claires.",
        created_at: "2026-10-23T09:00:00Z",
      },
    ],
    messages: [
      {
        id: "message-1",
        intervention_id: "demo-001",
        author_id: DEMO_IDS.artisan,
        body: "Bonjour, le devis détaillé est disponible dans votre demande. Vous pouvez le consulter avant de prendre votre décision.",
        created_at: "2026-10-30T10:10:00Z",
      },
    ],
    artisan_profile: null,
  };
}
export function proSeed(): ProfessionalData {
  return {
    ...EMPTY_PROFESSIONAL,
    approval_rules: [
      {
        id: "rule-demo",
        site_id: "site-1",
        threshold_cents: 20000,
        required_role: "manager",
        enabled: true,
      },
    ],
    approvals: [
      {
        id: "approval-demo",
        quote_id: "quote-demo-1",
        site_id: "site-1",
        status: "pending",
        created_at: "2026-10-30T10:01:00Z",
      },
    ],
    contracts: [],
    compliance_records: [
      {
        id: "compliance-demo",
        site_id: "site-3",
        title: "Revue de l’éclairage des espaces de travail",
        kind: "maintenance",
        due_on: "2026-11-15",
        status: "pending",
        notes: "Exemple de suivi de maintenance, sans valeur de diagnostic.",
      },
    ],
  };
}
export function adminSeed(): (Profile & { created_at: string })[] {
  return [
    {
      id: DEMO_IDS.artisan,
      full_name: DEMO_NAMES.artisan,
      role: "artisan",
      artisan_approved: true,
      created_at: "2026-10-30T09:00:00Z",
    },
    {
      id: DEMO_IDS.artisan2,
      full_name: "Sam Laurent",
      role: "artisan",
      artisan_approved: false,
      created_at: "2026-10-30T10:00:00Z",
    },
  ];
}
export function artisanSeed(): ArtisanDossier {
  return {
    artisan_profile: {
      user_id: DEMO_IDS.artisan,
      company_name: "Martin Élec (démo)",
      siret: "",
      legal_status: "Entreprise individuelle",
      employee_count: 1,
      address: "3 rue des Ateliers, 97200 Fort-de-France",
      postal_codes: ["97200", "97233"],
      categories: ["panel", "socket", "lighting", "diagnostic"],
      available: true,
      application_status: "approved",
      submitted_at: "2026-10-01T09:00:00Z",
    },
    credentials: [],
  };
}
export type DemoOperations = Record<
  string,
  {
    appointment?: Appointment | null;
    report?: InterventionReport | null;
    travel_stage?: TravelStage;
    declined?: boolean;
  }
>;
export function demoParticipants(
  intervention: { artisan_id?: string | null; client_id?: string },
): Participant[] {
  if (!intervention.artisan_id) return [];
  return [
    {
      id: intervention.client_id || DEMO_IDS.client,
      full_name: DEMO_NAMES.client,
      phone: "05 96 00 00 00 (exemple)",
      role: "client",
    },
    {
      id: intervention.artisan_id,
      full_name: DEMO_NAMES.artisan,
      phone: "06 96 00 00 00 (exemple)",
      role: "artisan",
    },
  ];
}
export function adminOverviewFromDemo(
  ws: Workspace,
  artisans: (Profile & { created_at: string })[],
): AdminOverview {
  const paid = ws.payments.filter((p) => p.status === "paid");
  return {
    counts: {
      interventions: ws.interventions.length,
      active_interventions: ws.interventions.filter(
        (i) => !["paid", "cancelled"].includes(i.status),
      ).length,
      artisans: artisans.length,
      pending_applications: artisans.filter((a) => !a.artisan_approved).length,
      clients: 2,
      organizations: ws.organizations.length,
    },
    financial: {
      paid_service_cents: paid.reduce((n, p) => n + p.total_cents, 0),
      currency: "eur",
      platform_revenue_cents: null,
      note: "Montant des prestations payées (démonstration), pas revenu net plateforme.",
    },
    artisans: artisans.map((a) => ({
      ...a,
      company_name: a.id === DEMO_IDS.artisan ? "Martin Élec (démo)" : "",
      application_status: a.artisan_approved ? "approved" : "submitted",
    })),
    clients: [
      {
        id: DEMO_IDS.client,
        full_name: DEMO_NAMES.client,
        role: "client",
        created_at: "2026-10-01T09:00:00Z",
      },
      {
        id: DEMO_IDS.manager,
        full_name: DEMO_NAMES.manager,
        role: "manager",
        created_at: "2026-10-02T09:00:00Z",
      },
    ],
    organizations: ws.organizations,
    interventions: ws.interventions,
    audit: [],
    capabilities: {
      dispatch_before_quote_acceptance: true,
      refunds: false,
      invoices: false,
      support_tickets: false,
      list_limit: 100,
    },
  };
}
export function readDemo<T>(key: string, fallback: T, valid?: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { version?: number; data?: unknown } | unknown;
    const data =
      parsed && typeof parsed === "object" && "data" in (parsed as object)
        ? (parsed as { data: unknown }).data
        : parsed;
    if (valid && !valid(data)) return fallback;
    return data as T;
  } catch {
    return fallback;
  }
}
export function writeDemo(key: string, data: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, data }));
    return true;
  } catch {
    return false;
  }
}
export function clearDemo() {
  try {
    for (const key of Object.values(DEMO_KEYS)) localStorage.removeItem(key);
  } catch {}
}
export const demoWarrantyRead = (): WarrantyCase[] =>
  readDemo<WarrantyCase[]>(DEMO_KEYS.warranty, [], Array.isArray);
