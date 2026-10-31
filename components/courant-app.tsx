"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createClient } from "../lib/supabase/client";
import { CATEGORIES as DOMAIN_CATEGORIES } from "../lib/domain";

type Role = "client" | "artisan" | "manager" | "admin";
type View =
  | "overview"
  | "requests"
  | "new"
  | "detail"
  | "missions"
  | "messages"
  | "documents"
  | "sites"
  | "profile"
  | "help"
  | "auth"
  | "admin";
type Status =
  | "requested"
  | "assigned"
  | "quoted"
  | "accepted"
  | "in_progress"
  | "completed"
  | "paid"
  | "cancelled";
type Category = "outage" | "panel" | "socket" | "lighting" | "diagnostic";
type Line = { label: string; quantity: number; unit_price_cents: number };
type Intervention = {
  id: string;
  category: Category;
  description: string;
  address: string;
  postal_code: string;
  city: string;
  urgency: "urgent" | "scheduled";
  status: Status;
  created_at: string;
  estimate_min_cents: number;
  estimate_max_cents: number;
  artisan_id?: string | null;
  client_id?: string;
  site_id?: string | null;
};
type Quote = {
  id: string;
  intervention_id: string;
  lines: Line[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_rate: number;
  status: string;
  created_at: string;
};
type Site = {
  id: string;
  name: string;
  type?: string;
  vertical?: string;
  address: string;
  budget_cents?: number;
};
type Message = {
  id: string;
  intervention_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
type Profile = {
  id: string;
  full_name: string;
  role: Role;
  artisan_approved?: boolean;
  approved?: boolean;
  phone?: string;
};
type ApprovalRule = {
  id: string;
  site_id: string;
  threshold_cents: number;
  required_role: string;
  enabled: boolean;
};
type Approval = {
  id: string;
  quote_id: string;
  site_id?: string;
  status: string;
  note?: string;
};
type Contract = {
  id: string;
  organization_id: string;
  title: string;
  reference: string;
  starts_on: string;
  ends_on?: string;
  terms: string;
  status: string;
};
type ComplianceRecord = {
  id: string;
  site_id: string;
  title: string;
  kind: string;
  due_on: string;
  status: string;
  notes: string;
};
type ProfessionalData = {
  approval_rules: ApprovalRule[];
  approvals: Approval[];
  contracts: Contract[];
  compliance_records: ComplianceRecord[];
};
const EMPTY_PRO: ProfessionalData = {
  approval_rules: [],
  approvals: [],
  contracts: [],
  compliance_records: [],
};
const PRO_DEMO_KEY = "courant-professional-demo-v1";
function proSeed(): ProfessionalData {
  return {
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
type StoredDocument = {
  id: string;
  intervention_id?: string | null;
  name: string;
  mime_type: string;
  created_at: string;
};
type Review = {
  id: string;
  intervention_id: string;
  rating: number;
  body: string;
};
type Workspace = {
  documents: StoredDocument[];
  reviews: Review[];
  profile: Profile | null;
  interventions: Intervention[];
  quotes: Quote[];
  sites: Site[];
  organizations: { id: string; name: string; type?: string }[];
  messages: Message[];
};
const EMPTY: Workspace = {
  documents: [],
  reviews: [],
  profile: null,
  interventions: [],
  quotes: [],
  sites: [],
  organizations: [],
  messages: [],
};
const CATEGORIES: {
  id: Category;
  label: string;
  description: string;
  icon: string;
  min: number;
  max: number;
}[] = [
  {
    id: "outage",
    label: "Coupure de courant",
    description: "Tout ou partie du logement",
    icon: "power",
    min: 15000,
    max: 25000,
  },
  {
    id: "panel",
    label: "Tableau électrique",
    description: "Disjoncteur, fusible ou tableau",
    icon: "panel",
    min: 15000,
    max: 35000,
  },
  {
    id: "socket",
    label: "Prise ou interrupteur",
    description: "Une prise ou un point de commande",
    icon: "plug",
    min: 8000,
    max: 18000,
  },
  {
    id: "lighting",
    label: "Éclairage",
    description: "Luminaire ou circuit d’éclairage",
    icon: "bulb",
    min: 8000,
    max: 20000,
  },
  {
    id: "diagnostic",
    label: "Recherche de panne",
    description: "L’origine du problème est inconnue",
    icon: "search",
    min: 12000,
    max: 28000,
  },
];
const STATUS: Record<Status, string> = {
  requested: "Recherche d’un artisan",
  assigned: "Artisan affecté",
  quoted: "Devis à valider",
  accepted: "Devis accepté",
  in_progress: "Intervention en cours",
  completed: "À régler",
  paid: "Terminée et réglée",
  cancelled: "Annulée",
};
const ROLE_NAMES: Record<Role, string> = {
  client: "Particulier",
  artisan: "Artisan",
  manager: "Professionnel",
  admin: "Administration",
};
const VIEW_NAMES: Record<View, string> = {
  overview: "Vue d’ensemble",
  requests: "Mes demandes",
  new: "Nouvelle demande",
  detail: "Détail de l’intervention",
  missions: "Mes missions",
  messages: "Messages",
  documents: "Documents",
  sites: "Mes sites",
  profile: "Mon profil",
  help: "Aide et informations",
  auth: "Connexion",
  admin: "Administration",
};
const money = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
const date = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(
    new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value),
  );
const category = (id: string) => {
  const visual = CATEGORIES.find((c) => c.id === id) || CATEGORIES[4];
  const domain = DOMAIN_CATEGORIES.find((c) => c.id === visual.id)!;
  return { ...visual, min: domain.min, max: domain.max };
};
const shortId = (id: string) =>
  id.startsWith("demo-")
    ? `INT-${id.toUpperCase()}`
    : `INT-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
const uid = () => crypto.randomUUID();
const DEMO_KEY = "courant-demo-v2";
const PATHS: Record<string, ReactNode> = {
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3Z" />
      <path d="M9 20v-7h6v7" />
    </>
  ),
  list: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plug: (
    <>
      <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v5" />
    </>
  ),
  panel: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7v4m4-4v4m4-4v4M8 16h8" />
    </>
  ),
  power: (
    <>
      <path d="M12 2v10M6 5a9 9 0 1 0 12 0" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 3H9Z" />
    </>
  ),
  message: <path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z" />,
  document: (
    <>
      <path d="M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h8" />
    </>
  ),
  building: (
    <>
      <path d="M4 22V4h12v18M16 10h4v12M8 8h4m-4 4h4m-4 4h4m-4 4h4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z" />
      <path d="m8 11 3 3 5-6" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 3H3v18h6M12 12h10m-4-4 4 4-4 4" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" />
    </>
  ),
  send: <path d="m22 2-7 20-4-9-9-4ZM11 13 22 2" />,
  wrench: <path d="M21 5a6 6 0 0 1-8 8l-8 8-3-3 8-8a6 6 0 0 1 8-8l-4 4 4 3Z" />,
  euro: (
    <>
      <path d="M19 5a7 7 0 0 0-11 5v4a7 7 0 0 0 11 5M4 10h11M4 14h9" />
    </>
  ),
  star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 5 10 8L22 5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="12" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  warning: (
    <>
      <path d="m12 2 10 19H2Z" />
      <path d="M12 8v5m0 4h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 2v6m10-6v6M3 11h18" />
    </>
  ),
  bell: (
    <>
      <path d="M5 16V9a7 7 0 0 1 14 0v7l2 3H3ZM9 22h6" />
    </>
  ),
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.bolt}
    </svg>
  );
}
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="bolt" size={23} />
      </span>
      <span>
        courant<span className="brand-dot">.</span>
        {!compact && <small>Le dépannage électrique, au clair.</small>}
      </span>
    </span>
  );
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge status-${status}`}>
      <span />
      {STATUS[status]}
    </span>
  );
}
function Empty({
  icon = "list",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function seed(): Workspace {
  return {
    documents: [],
    reviews: [],
    profile: null,
    organizations: [{ id: "org-demo", name: "Maison & lieux", type: "syndic" }],
    sites: [
      {
        id: "site-1",
        name: "Résidence des Alizés",
        type: "syndic",
        address: "12 rue des Alizés, Fort-de-France",
        budget_cents: 500000,
      },
      {
        id: "site-2",
        name: "Restaurant Le Patio",
        type: "restaurant",
        address: "8 rue du Marché, Fort-de-France",
        budget_cents: 300000,
      },
      {
        id: "site-3",
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
        artisan_id: "demo-artisan",
        client_id: "demo-client",
        site_id: "site-1",
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
        client_id: "demo-client",
        site_id: "site-2",
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
        estimate_min_cents: 8000,
        estimate_max_cents: 20000,
        artisan_id: "demo-artisan",
        client_id: "demo-client",
        site_id: "site-3",
      },
    ],
    quotes: [
      {
        id: "quote-demo-1",
        intervention_id: "demo-001",
        lines: [
          {
            label: "Déplacement et diagnostic",
            quantity: 1,
            unit_price_cents: 6000,
          },
          {
            label: "Main-d’œuvre (forfait)",
            quantity: 1,
            unit_price_cents: 9000,
          },
          {
            label: "Fournitures électriques",
            quantity: 1,
            unit_price_cents: 3500,
          },
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
      },
    ],
    messages: [
      {
        id: "message-1",
        intervention_id: "demo-001",
        author_id: "demo-artisan",
        body: "Bonjour, le devis détaillé est disponible dans votre demande. Vous pouvez le consulter avant de prendre votre décision.",
        created_at: "2026-10-30T10:10:00Z",
      },
    ],
  };
}
async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({
    error: "Le service n’a pas renvoyé de réponse exploitable.",
  }));
  if (!response.ok)
    throw new Error(
      data.error || "L’action n’a pas pu être réalisée. Réessayez.",
    );
  return data as T;
}
function download(
  name: string,
  content: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CourantApp() {
  const [professional, setProfessional] = useState<ProfessionalData>(EMPTY_PRO);
  const [connection, setConnection] = useState("");
  const [mode, setMode] = useState<"public" | "demo" | "live">("public");
  const [view, setView] = useState<View>("overview");
  const [role, setRole] = useState<Role>("client");
  const [data, setData] = useState<Workspace>(EMPTY);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobile, setMobile] = useState(false);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<Category>("panel");
  const [siteFilter, setSiteFilter] = useState("all");
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [pendingDraft, setPendingDraft] = useState<RequestValues | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "reset">(
    "login",
  );
  async function loadProfessional() {
    if (mode !== "live" || role !== "manager") return;
    try {
      const result = await api<ProfessionalData>("/api/professional");
      setProfessional(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function go(next: View) {
    setView(next);
    setError("");
    setNotice("");
    setMobile(false);
    if (typeof window !== "undefined") {
      window.location.hash = next;
      window.scrollTo({ top: 0 });
    }
  }
  async function refresh() {
    if (mode !== "live") setLoading(true);
    setError("");
    try {
      const ws = await api<Workspace>("/api/workspace");
      setData({ ...EMPTY, ...ws });
      if (ws.profile) {
        setRole(ws.profile.role);
        setMode("live");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const client = createClient();
        const { data: auth } = await client.auth.getUser();
        if (active && auth.user) await refresh();
      } catch {
        /* Public access remains available without a configured backend. */
      } finally {
        if (active) setLoading(false);
      }
    }
    try {
      const draft = JSON.parse(
        sessionStorage.getItem("courant-request-draft") || "null",
      );
      if (
        draft &&
        draft.savedAt > Date.now() - 1800000 &&
        draft.values?.category
      )
        setPendingDraft(draft.values);
    } catch {}
    void init();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (mode === "demo") {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify({ version: 1, data }));
      } catch {
        setNotice(
          "Le navigateur ne permet pas de conserver cette démonstration. Gardez cette page ouverte.",
        );
      }
    }
  }, [data, mode]);
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1) as View;
      if (Object.keys(VIEW_NAMES).includes(h)) setView(h);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (mode === "demo") {
      try {
        localStorage.setItem(
          PRO_DEMO_KEY,
          JSON.stringify({ version: 1, data: professional }),
        );
      } catch {}
    }
  }, [professional, mode]);
  useEffect(() => {
    if (mode === "live" && role === "manager") void loadProfessional();
  }, [mode, role]);
  useEffect(() => {
    if (mode !== "live" || !data.profile?.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const client = createClient();
    let channel = client.channel(`workspace-${data.profile.id}`);
    for (const table of ["interventions", "quotes", "messages"])
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (active) void refresh();
          }, 350);
        },
      );
    channel.subscribe((status) => {
      if (active) setConnection(status);
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [mode, data.profile?.id]);
  function demo(next: View = "overview") {
    let ds = seed();
    try {
      const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
      if (
        saved?.version === 1 &&
        Array.isArray(saved.data?.interventions) &&
        Array.isArray(saved.data?.quotes) &&
        Array.isArray(saved.data?.sites) &&
        Array.isArray(saved.data?.messages)
      )
        ds = { ...EMPTY, ...saved.data };
    } catch {}
    let pro = proSeed();
    try {
      const stored = JSON.parse(localStorage.getItem(PRO_DEMO_KEY) || "null");
      if (stored?.version === 1) pro = { ...EMPTY_PRO, ...stored.data };
    } catch {}
    setProfessional(pro);
    setData(ds);
    setMode("demo");
    setRole("client");
    setLoading(false);
    go(next);
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (mode === "live")
      await run(async () => {
        const result = await createClient().auth.signOut();
        if (result.error) throw result.error;
        setData(EMPTY);
        setMode("public");
        go("overview");
      });
    else {
      setMode("public");
      setData(EMPTY);
      go("overview");
    }
  }
  const profile = data.profile;
  const name =
    mode === "demo"
      ? data.profile?.role === role
        ? data.profile.full_name
        : role === "artisan"
          ? "Alex Martin"
          : role === "manager"
            ? "Camille Bernard"
            : "Camille"
      : profile?.full_name || "Bienvenue";
  const active = data.interventions.filter(
    (i) => !["paid", "cancelled"].includes(i.status),
  );
  const awaiting = data.interventions.filter((i) => i.status === "quoted");
  const completed = data.interventions.filter((i) => i.status === "paid");
  const current = data.interventions.find((i) => i.id === selected);
  const currentQuote = data.quotes
    .filter((q) => q.intervention_id === selected)
    .sort(
      (a, b) =>
        Number(["sent", "accepted"].includes(b.status)) -
          Number(["sent", "accepted"].includes(a.status)) ||
        Date.parse(b.created_at) - Date.parse(a.created_at),
    )[0];
  const nav: { id: View; label: string; icon: string; count?: number }[] = [
    { id: "overview", label: "Vue d’ensemble", icon: "home" },
    {
      id: role === "artisan" ? "missions" : "requests",
      label: role === "artisan" ? "Mes missions" : "Mes demandes",
      icon: "list",
      count: active.length,
    },
    {
      id: "messages",
      label: "Messages",
      icon: "message",
      count: data.messages.length,
    },
    { id: "documents", label: "Documents", icon: "document" },
    ...(role === "manager"
      ? [{ id: "sites" as View, label: "Mes sites", icon: "building" }]
      : []),
    ...(role === "admin"
      ? [{ id: "admin" as View, label: "Administration", icon: "shield" }]
      : []),
  ];
  function detail(id: string) {
    setSelected(id);
    go("detail");
  }
  function newRequest(id?: Category) {
    if (id) setCategoryId(id);
    go("new");
  }
  function saveDemo(next: Workspace) {
    setData(next);
  }
  async function action(
    id: string,
    actionName: string,
    extra?: Record<string, unknown>,
  ) {
    await run(async () => {
      if (mode === "demo") {
        const i = data.interventions.find((x) => x.id === id);
        if (!i) throw new Error("Demande introuvable.");
        if (actionName === "accept_mission") {
          const stored = localStorage.getItem("courant-admin-demo-v1");
          const artisan = stored
            ? (JSON.parse(stored) as Profile[]).find(
                (p) => p.id === "demo-artisan",
              )
            : null;
          if (artisan && !artisan.artisan_approved)
            throw new Error(
              "L’accès aux nouvelles missions de cet artisan de démonstration est suspendu. Réactivez sa candidature dans l’administration de démonstration.",
            );
        }
        const transitions: Record<string, Status> = {
          accept_mission: "assigned",
          send_quote: "quoted",
          accept_quote: "accepted",
          start: "in_progress",
          complete: "completed",
          cancel: "cancelled",
          simulate_payment: "paid",
        };
        const status = transitions[actionName];
        if (!status) throw new Error("Action inconnue.");
        if (actionName === "accept_quote") {
          const quote = data.quotes.find(
            (q) => q.intervention_id === id && q.status === "sent",
          );
          if (
            quote &&
            professional.approvals.some(
              (a) => a.quote_id === quote.id && a.status !== "approved",
            )
          )
            throw new Error(
              "Ce devis nécessite une approbation dans l’espace professionnel avant son acceptation.",
            );
        }
        const allowed: Record<string, Status[]> = {
          accept_mission: ["requested"],
          send_quote: ["assigned"],
          accept_quote: ["quoted"],
          start: ["accepted"],
          complete: ["in_progress"],
          cancel: ["requested", "assigned", "quoted"],
          simulate_payment: ["completed"],
        };
        if (!allowed[actionName]?.includes(i.status))
          throw new Error(
            "Cette action n’est plus disponible pour cette demande.",
          );
        let qs = data.quotes;
        if (actionName === "send_quote") {
          const lines = extra?.lines as Line[];
          const rate = Number(extra?.tax_rate);
          const subtotal = lines.reduce(
            (n, l) => n + Math.round(l.quantity * l.unit_price_cents),
            0,
          );
          qs = [
            ...qs,
            {
              id: uid(),
              intervention_id: id,
              lines,
              subtotal_cents: subtotal,
              tax_cents: Math.round((subtotal * rate) / 100),
              total_cents: subtotal + Math.round((subtotal * rate) / 100),
              tax_rate: rate,
              status: "sent",
              created_at: new Date().toISOString(),
            },
          ];
        }
        if (actionName === "send_quote" && i.site_id) {
          const rule = professional.approval_rules.find(
            (r) => r.site_id === i.site_id && r.enabled,
          );
          const quote = qs.at(-1);
          if (rule && quote && quote.total_cents > rule.threshold_cents)
            setProfessional({
              ...professional,
              approvals: [
                ...professional.approvals,
                {
                  id: uid(),
                  site_id: i.site_id,
                  quote_id: quote.id,
                  status: "pending",
                },
              ],
            });
        }
        if (actionName === "accept_quote")
          qs = qs.map((q) =>
            q.intervention_id === id ? { ...q, status: "accepted" } : q,
          );
        saveDemo({
          ...data,
          quotes: qs,
          interventions: data.interventions.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status,
                  artisan_id:
                    actionName === "accept_mission"
                      ? "demo-artisan"
                      : x.artisan_id,
                }
              : x,
          ),
        });
        setNotice(
          actionName === "simulate_payment"
            ? "Paiement simulé. Aucun débit bancaire n’a été effectué."
            : "Modification enregistrée dans la démonstration.",
        );
      } else {
        await api(`/api/interventions/${id}/actions`, {
          action: actionName,
          ...extra,
        });
        await refresh();
        setNotice("Modification enregistrée.");
      }
    });
  }
  async function checkout() {
    if (!currentQuote) return;
    await run(async () => {
      const result = await api<{ url: string }>("/api/payments/checkout", {
        quote_id: currentQuote.id,
      });
      if (!result.url?.startsWith("https://checkout.stripe.com/"))
        throw new Error("La session de paiement n’est pas disponible.");
      window.location.assign(result.url);
    });
  }
  function exportCsv() {
    const rows = [
      [
        "Référence",
        "Type",
        "Statut",
        "Adresse",
        "Site",
        "Estimation min EUR",
        "Estimation max EUR",
      ],
      ...data.interventions
        .filter((i) => siteFilter === "all" || i.site_id === siteFilter)
        .map((i) => [
          shortId(i.id),
          category(i.category).label,
          STATUS[i.status],
          `${i.address} ${i.city}`,
          data.sites.find((s) => s.id === i.site_id)?.name || "",
          String(i.estimate_min_cents / 100),
          String(i.estimate_max_cents / 100),
        ]),
    ];
    download(
      "courant-interventions.csv",
      "\uFEFF" +
        rows
          .map((r) =>
            r
              .map(
                (c) =>
                  `"${String(c)
                    .replace(/^[=+@-]/, "'$&")
                    .replaceAll('"', '""')}"`,
              )
              .join(";"),
          )
          .join("\r\n"),
      "text/csv;charset=utf-8",
    );
    setNotice("L’export a été téléchargé.");
  }
  function requestList(items: Intervention[], limit?: number) {
    const list = limit ? items.slice(0, limit) : items;
    return list.length ? (
      <div className="request-list">
        {list.map((i) => (
          <button
            className="request-row"
            key={i.id}
            onClick={() => detail(i.id)}
          >
            <span className={`service-icon ${i.category}`}>
              <Icon name={category(i.category).icon} size={24} />
            </span>
            <span className="request-content">
              <span className="request-title">
                {category(i.category).label}
              </span>
              <span className="request-address">
                <Icon name="location" size={13} />
                {i.address ? `${i.address}, ` : ""}
                {i.city}
              </span>
              <span className="request-ref">
                {shortId(i.id)} <span>·</span> {date(i.created_at)}
              </span>
            </span>
            <span className="request-meta">
              <Badge status={i.status} />
              <span className="request-price">
                {i.urgency === "urgent" && (
                  <span className="urgent-text">Urgent</span>
                )}
                {money(i.estimate_min_cents)} – {money(i.estimate_max_cents)}
              </span>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        ))}
      </div>
    ) : (
      <Empty
        title="Aucune demande dans cette liste"
        action={
          <button className="button primary" onClick={() => newRequest()}>
            Créer une demande
          </button>
        }
      >
        Vous retrouverez ici les interventions correspondant à vos filtres.
      </Empty>
    );
  }
  const renderPublic = () => (
    <>
      <header className="public-header">
        <button
          className="brand-button"
          onClick={() => go("overview")}
          aria-label="Courant, accueil"
        >
          <Brand />
        </button>
        <nav aria-label="Navigation principale">
          <button onClick={() => go("help")}>Comment ça marche</button>
          <button
            onClick={() => {
              setAuthMode("signup");
              go("auth");
            }}
          >
            Vous êtes artisan ?
          </button>
          <button
            className="button outline"
            onClick={() => {
              setAuthMode("login");
              go("auth");
            }}
          >
            Se connecter
          </button>
        </nav>
      </header>
      <main id="main" className="public-main">
        {view === "auth" ? (
          Auth()
        ) : view === "new" ? (
          NewRequest()
        ) : view === "help" ? (
          Help()
        ) : (
          <>
            <section className="landing">
              <div className="landing-copy">
                <span className="context-line">
                  <span className="mini-bolt">
                    <Icon name="bolt" size={16} />
                  </span>
                  Dépannage électrique pour particuliers et professionnels
                </span>
                <h1>
                  Une panne électrique.
                  <br />
                  Un parcours clair.
                </h1>
                <p>
                  Décrivez le problème, consultez une estimation et validez le
                  devis de votre artisan. Retrouvez chaque étape au même
                  endroit.
                </p>
                <div className="landing-actions">
                  <button
                    className="button primary large"
                    onClick={() => newRequest()}
                  >
                    <Icon name="plus" />
                    Demander une intervention
                  </button>
                  <button className="text-button" onClick={() => demo()}>
                    Explorer la démonstration <Icon name="arrow" size={16} />
                  </button>
                </div>
                <div className="landing-assurance">
                  <span>
                    <Icon name="document" />
                    Devis avant intervention
                  </span>
                  <span>
                    <Icon name="lock" />
                    Paiement avec Stripe
                  </span>
                </div>
              </div>
              <div className="service-board">
                <div className="service-board-head">
                  <Icon name="panel" size={24} />
                  <span>De la demande à la résolution</span>
                  <span className="board-mark">C.</span>
                </div>
                <div className="board-flow">
                  <div>
                    <span className="flow-node">1</span>
                    <section>
                      <strong>Vous décrivez la panne</strong>
                      <p>Le problème, le lieu et votre besoin.</p>
                    </section>
                  </div>
                  <div>
                    <span className="flow-node">2</span>
                    <section>
                      <strong>Vous validez le devis</strong>
                      <p>Un détail des prestations et du prix.</p>
                    </section>
                  </div>
                  <div>
                    <span className="flow-node last">
                      <Icon name="check" size={18} />
                    </span>
                    <section>
                      <strong>Vous suivez l’intervention</strong>
                      <p>Le suivi et les documents réunis.</p>
                    </section>
                  </div>
                </div>
                <div className="board-note">
                  <Icon name="shield" />
                  <span>Vous gardez la main sur votre demande.</span>
                </div>
              </div>
            </section>
            <section className="public-services">
              <div className="section-heading">
                <div>
                  <h2>Quel est le problème ?</h2>
                  <p>Commencez par ce qui vous ressemble le plus.</p>
                </div>
              </div>
              <div className="service-options">
                {CATEGORIES.map((c) => (
                  <button key={c.id} onClick={() => newRequest(c.id)}>
                    <Icon name={c.icon} size={28} />
                    <strong>{c.label}</strong>
                    <span>{c.description}</span>
                    <Icon name="arrow" size={16} />
                  </button>
                ))}
              </div>
            </section>
            <section className="professional-band">
              <span className="band-icon">
                <Icon name="building" size={38} />
              </span>
              <div>
                <h2>Plusieurs sites. Un seul espace de suivi.</h2>
                <p>
                  Syndics, restaurants, bureaux et établissements recevant du
                  public : organisez vos demandes par site.
                </p>
              </div>
              <button
                className="button outline"
                onClick={() => {
                  demo();
                  setRole("manager");
                }}
              >
                Découvrir l’espace professionnel
              </button>
            </section>
          </>
        )}
      </main>
      <footer className="public-footer">
        <Brand compact />
        <span>Courant est un nom de travail. Application en préparation.</span>
        <button onClick={() => go("help")}>Aide et informations</button>
      </footer>
    </>
  );
  function Alerts() {
    return (
      <>
        {error && (
          <div className="alert error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              aria-label="Fermer le message d’erreur"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            <Icon name="check" />
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Fermer le message"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </>
    );
  }
  // Components below are rendered as function calls to preserve form focus across parent updates.
  function Overview() {
    const focus = awaiting[0] || active[0];
    return (
      <>
        <div className="welcome">
          <div>
            <h1>
              Bonjour {name.split(" ")[0]}
              <span className="hello-dot">.</span>
            </h1>
            <p>
              {role === "artisan"
                ? "Vos missions et vos devis, au même endroit."
                : role === "manager"
                  ? "Gardez une vue claire sur les interventions de vos sites."
                  : "Le point sur vos demandes et vos interventions."}
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => (role === "artisan" ? go("missions") : newRequest())}
          >
            <Icon name={role === "artisan" ? "search" : "plus"} />
            {role === "artisan" ? "Voir les missions" : "Nouvelle demande"}
          </button>
        </div>
        {role === "artisan" &&
        mode === "live" &&
        !profile?.artisan_approved &&
        !profile?.approved ? (
          <div className="alert warning">
            <Icon name="shield" />
            <span>
              Votre candidature doit être approuvée avant de pouvoir accepter
              une mission.
            </span>
          </div>
        ) : null}
        <div className="stats-strip">
          <div>
            <span className="stat-icon blue">
              <Icon name="list" />
            </span>
            <section>
              <span>Interventions en cours</span>
              <strong>{active.length.toString().padStart(2, "0")}</strong>
            </section>
          </div>
          <div>
            <span className="stat-icon amber">
              <Icon name="document" />
            </span>
            <section>
              <span>
                {role === "artisan" ? "Devis envoyés" : "Devis à valider"}
              </span>
              <strong>{awaiting.length.toString().padStart(2, "0")}</strong>
            </section>
          </div>
          <div>
            <span className="stat-icon green">
              <Icon name="check" />
            </span>
            <section>
              <span>Interventions terminées</span>
              <strong>{completed.length.toString().padStart(2, "0")}</strong>
            </section>
          </div>
          {role === "manager" && (
            <div>
              <span className="stat-icon blue">
                <Icon name="building" />
              </span>
              <section>
                <span>Sites suivis</span>
                <strong>{data.sites.length.toString().padStart(2, "0")}</strong>
              </section>
            </div>
          )}
        </div>
        <div className="overview-grid">
          <div className="main-column">
            {focus && (
              <section className="attention-panel">
                <div className="attention-title">
                  <span>
                    <Icon
                      name={focus.status === "quoted" ? "document" : "clock"}
                      size={22}
                    />
                  </span>
                  <strong>
                    {focus.status === "quoted"
                      ? "Un devis attend votre attention"
                      : "Votre prochaine étape"}
                  </strong>
                  <Badge status={focus.status} />
                </div>
                <div className="attention-body">
                  <section>
                    <h2>{category(focus.category).label}</h2>
                    <p>
                      <Icon name="location" size={15} />
                      {focus.address}, {focus.city}
                    </p>
                    <span>
                      {focus.status === "quoted"
                        ? "Consultez les prestations proposées et le montant détaillé."
                        : "Consultez votre demande pour retrouver son avancement."}
                    </span>
                  </section>
                  <button
                    className="button primary"
                    onClick={() => detail(focus.id)}
                  >
                    {focus.status === "quoted"
                      ? "Consulter le devis"
                      : "Voir la demande"}
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              </section>
            )}
            <section className="panel">
              <div className="section-heading">
                <h2>Interventions récentes</h2>
                <button
                  className="text-button"
                  onClick={() => {
                    setFilter("all");
                    go(role === "artisan" ? "missions" : "requests");
                  }}
                >
                  Tout voir <Icon name="arrow" size={15} />
                </button>
              </div>
              {requestList(data.interventions, 4)}
            </section>
            <section className="quick-start">
              <div>
                <h2>Un nouveau problème électrique ?</h2>
                <p>
                  Quelques informations suffisent pour commencer votre demande.
                </p>
              </div>
              <div className="quick-categories">
                {CATEGORIES.slice(0, 4).map((c) => (
                  <button key={c.id} onClick={() => newRequest(c.id)}>
                    <Icon name={c.icon} size={24} />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          <aside className="side-column">
            <section className="help-panel">
              <span className="help-symbol">
                <Icon name="shield" size={27} />
              </span>
              <h2>
                Le devis vous donne
                <br />
                le dernier mot.
              </h2>
              <p>
                L’estimation est indicative. Avant de commencer, votre artisan
                vous propose un devis détaillé à accepter.
              </p>
              <button className="text-button" onClick={() => go("help")}>
                Comprendre les étapes <Icon name="arrow" size={15} />
              </button>
            </section>
            <section className="sidebar-note">
              <Icon name="document" />
              <h3>Vos documents, rassemblés.</h3>
              <p>Retrouvez les devis de vos interventions dans votre espace.</p>
              <button className="text-button" onClick={() => go("documents")}>
                Voir mes documents <Icon name="arrow" size={15} />
              </button>
            </section>
            <div className="support-link">
              <span>
                <Icon name="help" />
              </span>
              <section>
                <strong>Une question sur le parcours ?</strong>
                <button onClick={() => go("help")}>Consulter l’aide</button>
              </section>
            </div>
          </aside>
        </div>
      </>
    );
  }
  function Requests() {
    let rows = data.interventions.filter(
      (i) =>
        (filter === "all" ||
          (filter === "active" && !["paid", "cancelled"].includes(i.status)) ||
          (filter === "past" && ["paid", "cancelled"].includes(i.status)) ||
          (filter === "available" && i.status === "requested")) &&
        (siteFilter === "all" || i.site_id === siteFilter),
    );
    if (search.trim())
      rows = rows.filter((i) =>
        `${category(i.category).label} ${i.address} ${i.city} ${shortId(i.id)}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      );
    return (
      <>
        <PageTitle
          title={role === "artisan" ? "Mes missions" : "Mes demandes"}
          subtitle="Retrouvez chaque intervention et son avancement."
          action={
            <button className="button primary" onClick={() => newRequest()}>
              <Icon name="plus" />
              Nouvelle demande
            </button>
          }
        />
        <div className="list-tools">
          <div className="tabs" role="group" aria-label="Filtrer les demandes">
            {[
              ["active", "En cours"],
              ["all", "Toutes"],
              ["past", "Terminées"],
              ...(role === "artisan" ? [["available", "Disponibles"]] : []),
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? "active" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              aria-label="Rechercher une intervention"
              placeholder="Rechercher une intervention"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <section className="panel">{requestList(rows)}</section>
      </>
    );
  }
  function PageTitle({
    title,
    subtitle,
    action: act,
  }: {
    title: string;
    subtitle: string;
    action?: ReactNode;
  }) {
    return (
      <div className="page-title">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {act}
      </div>
    );
  }
  function NewRequest() {
    return (
      <RequestForm
        initialCategory={categoryId}
        initialValues={pendingDraft}
        sites={data.sites}
        mode={mode}
        busy={busy}
        onBack={() => go(mode === "public" ? "overview" : "requests")}
        onSubmit={async (values) => {
          await run(async () => {
            if (mode === "public") {
              setPendingDraft(values);
              try {
                sessionStorage.setItem(
                  "courant-request-draft",
                  JSON.stringify({ savedAt: Date.now(), values }),
                );
              } catch {}
              setAuthMode("signup");
              go("auth");
              setNotice(
                "Votre brouillon est conservé. Connectez-vous ou créez votre compte pour enregistrer cette demande.",
              );
              return;
            }
            if (mode === "demo") {
              const c = category(values.category);
              const intervention: Intervention = {
                ...values,
                id: uid(),
                status: "requested",
                client_id: "demo-client",
                created_at: new Date().toISOString(),
                estimate_min_cents: c.min,
                estimate_max_cents: c.max,
              };
              saveDemo({
                ...data,
                interventions: [intervention, ...data.interventions],
              });
              setPendingDraft(null);
              try {
                sessionStorage.removeItem("courant-request-draft");
              } catch {}
              setSelected(intervention.id);
              go("detail");
              setNotice(
                "Demande enregistrée dans la démonstration, sans envoi à un artisan réel.",
              );
            } else {
              const result = await api<{ intervention: Intervention }>(
                "/api/interventions",
                values,
              );
              await refresh();
              setPendingDraft(null);
              try {
                sessionStorage.removeItem("courant-request-draft");
              } catch {}
              if (result.intervention?.id) {
                setSelected(result.intervention.id);
                go("detail");
              } else go("requests");
              setNotice("Votre demande a été enregistrée.");
            }
          });
        }}
        onDemo={() => demo("new")}
      />
    );
  }
  function Detail() {
    if (!current)
      return (
        <Empty
          title="Sélectionnez une intervention"
          action={
            <button className="button primary" onClick={() => go("requests")}>
              Voir mes demandes
            </button>
          }
        />
      );
    const i = current;
    const progress: Status[] = [
      "requested",
      "assigned",
      "quoted",
      "accepted",
      "in_progress",
      "completed",
      "paid",
    ];
    const pi = progress.indexOf(i.status);
    return (
      <>
        <button
          className="back-link"
          onClick={() => go(role === "artisan" ? "missions" : "requests")}
        >
          <Icon name="back" size={17} />
          Retour aux {role === "artisan" ? "missions" : "demandes"}
        </button>
        <PageTitle
          title={category(i.category).label}
          subtitle={`${shortId(i.id)} — Créée le ${date(i.created_at)}`}
          action={<Badge status={i.status} />}
        />
        <div className="detail-grid">
          <div>
            <section className="panel detail-summary">
              <div className="section-heading">
                <h2>Votre demande</h2>
                {i.urgency === "urgent" && (
                  <span className="urgency-label">
                    <Icon name="clock" size={14} />
                    Urgente
                  </span>
                )}
              </div>
              <p className="description">
                {i.description ||
                  "Le détail et l’adresse seront accessibles après acceptation de la mission."}
              </p>
              <div className="detail-facts">
                <div>
                  <Icon name="location" />
                  <span>
                    <small>Lieu d’intervention</small>
                    <strong>
                      {i.address || "Adresse masquée avant attribution"}
                      <br />
                      {i.postal_code} {i.city}
                    </strong>
                  </span>
                </div>
                <div>
                  <Icon name="euro" />
                  <span>
                    <small>Estimation indicative</small>
                    <strong>
                      {money(i.estimate_min_cents)} –{" "}
                      {money(i.estimate_max_cents)}
                    </strong>
                  </span>
                </div>
              </div>
              {i.site_id && (
                <p className="site-tag">
                  <Icon name="building" size={16} />
                  {data.sites.find((s) => s.id === i.site_id)?.name ||
                    "Site professionnel"}
                </p>
              )}
            </section>
            <section className="panel timeline-panel">
              <h2>Avancement de l’intervention</h2>
              {i.status === "cancelled" ? (
                <p>Cette demande est annulée.</p>
              ) : (
                <ol className="timeline">
                  {progress.map((s, index) => (
                    <li key={s} className={index <= pi ? "reached" : ""}>
                      <span>
                        {index < pi ? (
                          <Icon name="check" size={13} />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div>
                        <strong>{STATUS[s]}</strong>
                        {index === pi && <small>Étape actuelle</small>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            {currentQuote ? (
              <section className="panel quote-panel">
                <div className="section-heading">
                  <h2>Devis détaillé</h2>
                  <span className="subtle">
                    {currentQuote.status === "accepted"
                      ? "Accepté"
                      : "À consulter"}
                  </span>
                </div>
                <div className="quote-lines">
                  {currentQuote.lines.map((l, index) => (
                    <div key={index}>
                      <section>
                        <strong>{l.label}</strong>
                        <span>
                          {l.quantity} × {money(l.unit_price_cents)} HT
                        </span>
                      </section>
                      <strong>
                        {money(Math.round(l.quantity * l.unit_price_cents))}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="quote-totals">
                  <div>
                    <span>Sous-total HT</span>
                    <strong>{money(currentQuote.subtotal_cents)}</strong>
                  </div>
                  <div>
                    <span>TVA ({currentQuote.tax_rate} %)</span>
                    <strong>{money(currentQuote.tax_cents)}</strong>
                  </div>
                  <div className="total">
                    <span>Total TTC</span>
                    <strong>{money(currentQuote.total_cents)}</strong>
                  </div>
                </div>
                <p className="form-note">
                  {mode === "demo"
                    ? "Montants et taux de TVA de démonstration uniquement."
                    : "Le devis précise le montant de l’intervention. Vérifiez les prestations avant acceptation."}
                </p>
                {["client", "manager"].includes(role) &&
                  i.status === "quoted" && (
                    <button
                      className="button primary full"
                      disabled={busy}
                      onClick={() => void action(i.id, "accept_quote")}
                    >
                      <Icon name="check" />
                      {busy ? "Enregistrement…" : "Accepter le devis"}
                    </button>
                  )}
                <button
                  className="button outline full"
                  onClick={() =>
                    download(
                      `devis-${shortId(i.id)}.txt`,
                      `${mode === "demo" ? "DÉMONSTRATION — AUCUNE VALEUR CONTRACTUELLE\n" : ""}DEVIS ${shortId(i.id)}\n${category(i.category).label}\n\n${currentQuote.lines.map((l) => `${l.label} : ${l.quantity} x ${money(l.unit_price_cents)} HT`).join("\n")}\n\nSous-total HT : ${money(currentQuote.subtotal_cents)}\nTVA : ${money(currentQuote.tax_cents)}\nTotal TTC : ${money(currentQuote.total_cents)}\nStatut : ${currentQuote.status}\n`,
                    )
                  }
                >
                  <Icon name="download" />
                  Télécharger le récapitulatif
                </button>
              </section>
            ) : null}
            {role === "artisan" && i.status === "assigned" && (
              <QuoteEditor
                busy={busy}
                demo={mode === "demo"}
                onSubmit={(lines) => void action(i.id, "send_quote", lines)}
              />
            )}
            {i.status === "paid" && (
              <>
                <ReviewForm
                  existing={(data.reviews || []).find(
                    (r) => r.intervention_id === i.id,
                  )}
                  enabled={role === "client" || role === "manager"}
                  busy={busy}
                  onSubmit={async (values) => {
                    await run(async () => {
                      if (mode === "demo")
                        saveDemo({
                          ...data,
                          reviews: [
                            ...(data.reviews || []),
                            { ...values, id: uid(), intervention_id: i.id },
                          ],
                        });
                      else {
                        await api("/api/reviews", {
                          ...values,
                          intervention_id: i.id,
                        });
                        await refresh();
                      }
                      setNotice(
                        mode === "demo"
                          ? "Avis enregistré dans la démonstration."
                          : "Votre avis a été enregistré.",
                      );
                    });
                  }}
                />
                <WarrantyPanel
                  interventionId={i.id}
                  demo={mode === "demo"}
                  role={role}
                />
              </>
            )}
          </div>
          <aside>
            <section className="next-step-panel">
              <span className="next-step-icon">
                <Icon
                  name={
                    i.status === "paid"
                      ? "check"
                      : i.status === "completed"
                        ? "lock"
                        : "clock"
                  }
                  size={26}
                />
              </span>
              <h2>
                {i.status === "requested"
                  ? "La demande est enregistrée"
                  : i.status === "paid"
                    ? "Intervention clôturée"
                    : "La prochaine étape"}
              </h2>
              <p>
                {i.status === "requested"
                  ? "Votre demande attend qu’un artisan éligible l’accepte. Aucun délai d’affectation n’est garanti."
                  : i.status === "assigned"
                    ? "L’artisan prépare le devis détaillé. Vous pourrez le consulter avant de l’accepter."
                    : i.status === "quoted"
                      ? "Le devis est disponible. Vérifiez le détail des prestations et le montant proposé."
                      : i.status === "accepted"
                        ? "Le devis est accepté. L’artisan peut démarrer l’intervention."
                        : i.status === "in_progress"
                          ? "L’artisan réalise l’intervention prévue au devis."
                          : i.status === "completed"
                            ? "L’intervention est terminée. Vous pouvez régler le devis accepté via Stripe."
                            : i.status === "paid"
                              ? "Le règlement est enregistré. Votre devis reste accessible dans vos documents."
                              : "La demande a été annulée."}
              </p>
              {role === "artisan" && i.status === "requested" && (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void action(i.id, "accept_mission")}
                >
                  Accepter la mission
                </button>
              )}
              {role === "artisan" && i.status === "accepted" && (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void action(i.id, "start")}
                >
                  Démarrer l’intervention
                </button>
              )}
              {role === "artisan" && i.status === "in_progress" && (
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void action(i.id, "complete")}
                >
                  Terminer l’intervention
                </button>
              )}
              {["client", "manager"].includes(role) &&
                i.status === "completed" && (
                  <button
                    className="button primary full"
                    disabled={busy}
                    onClick={() =>
                      mode === "demo"
                        ? void action(i.id, "simulate_payment")
                        : void checkout()
                    }
                  >
                    <Icon name="lock" />
                    {mode === "demo"
                      ? "Simuler le règlement"
                      : "Régler avec Stripe"}
                  </button>
                )}
              {mode === "demo" && (
                <p className="form-note">
                  Dans la démonstration, changez d’espace dans le menu pour
                  tester la suite du parcours.
                </p>
              )}
            </section>
            <section className="panel compact-panel">
              <h3>Besoin d’échanger ?</h3>
              <p>Retrouvez les messages liés à cette demande.</p>
              <button
                className="button outline full"
                onClick={() => go("messages")}
              >
                <Icon name="message" />
                Ouvrir les messages
              </button>
            </section>
            {["requested", "assigned", "quoted"].includes(i.status) &&
              ["client", "manager"].includes(role) && (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Annuler cette demande ? Cette action ne peut pas être annulée.",
                      )
                    )
                      void action(i.id, "cancel");
                  }}
                >
                  Annuler la demande
                </button>
              )}
          </aside>
        </div>
      </>
    );
  }
  function MessagesView() {
    return (
      <>
        <PageTitle
          title="Messages"
          subtitle="Les échanges liés à vos interventions restent regroupés ici."
        />
        <MessageCenter
          interventions={data.interventions}
          messages={data.messages}
          role={role}
          profileId={
            profile?.id || `demo-${role === "artisan" ? "artisan" : "client"}`
          }
          selectedId={selected}
          busy={busy}
          onSubmit={async (intervention_id, body) => {
            return await run(async () => {
              if (mode === "demo")
                saveDemo({
                  ...data,
                  messages: [
                    ...data.messages,
                    {
                      id: uid(),
                      intervention_id,
                      body,
                      author_id:
                        role === "artisan" ? "demo-artisan" : "demo-client",
                      created_at: new Date().toISOString(),
                    },
                  ],
                });
              else {
                await api("/api/messages", { intervention_id, body });
                await refresh();
              }
              setNotice(
                mode === "demo"
                  ? "Message enregistré dans la démonstration."
                  : "Message envoyé.",
              );
            });
          }}
        />
      </>
    );
  }
  function Documents() {
    return (
      <>
        <PageTitle
          title="Documents"
          subtitle="Les devis de vos interventions, réunis dans votre espace."
        />
        <section className="panel">
          {data.quotes.length ? (
            <div className="document-list">
              {data.quotes.map((q) => {
                const i = data.interventions.find(
                  (x) => x.id === q.intervention_id,
                );
                return (
                  <div key={q.id}>
                    <span className="service-icon">
                      <Icon name="document" size={25} />
                    </span>
                    <section>
                      <h3>
                        Devis —{" "}
                        {i ? category(i.category).label : "Intervention"}
                      </h3>
                      <p>
                        {date(q.created_at)} · {money(q.total_cents)} TTC ·{" "}
                        {q.status === "accepted"
                          ? "Accepté"
                          : q.status === "rejected"
                            ? "Remplacé ou refusé"
                            : "Envoyé"}
                      </p>
                    </section>
                    <button
                      className="button outline"
                      onClick={() => detail(q.intervention_id)}
                    >
                      Consulter
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="document" title="Aucun document pour le moment">
              Les devis apparaîtront ici après leur envoi par votre artisan.
            </Empty>
          )}
        </section>
        <DocumentManager
          documents={data.documents || []}
          interventions={data.interventions}
          demo={mode === "demo"}
          onRefresh={refresh}
        />
        <div className="inline-note">
          <Icon name="lock" />
          <p>
            Les documents d’assurance et justificatifs sont privés. Les liens de
            téléchargement sont temporaires et accessibles uniquement aux
            personnes autorisées.
          </p>
        </div>
      </>
    );
  }
  function Sites() {
    return (
      <>
        <PageTitle
          title="Mes sites"
          subtitle="Organisez les interventions de votre organisation."
          action={
            <button className="button outline" onClick={exportCsv}>
              <Icon name="download" />
              Exporter les interventions
            </button>
          }
        />
        <div
          className="tabs vertical-tabs"
          role="group"
          aria-label="Type d’activité"
        >
          {[
            ["all", "Tous"],
            ["syndic", "Copropriétés"],
            ["restaurant", "Restauration"],
            ["office", "Bureaux"],
            ["erp", "ERP"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={verticalFilter === id ? "active" : ""}
              onClick={() => setVerticalFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="list-tools">
          <label className="select-inline">
            Site
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
            >
              <option value="all">Tous les sites</option>
              {data.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <span className="subtle">
            {data.sites.length} site{data.sites.length > 1 ? "s" : ""} dans
            votre espace
          </span>
        </div>
        <div className="sites-grid">
          {data.sites
            .filter(
              (s) =>
                (siteFilter === "all" || s.id === siteFilter) &&
                (verticalFilter === "all" ||
                  (s.type || s.vertical) === verticalFilter),
            )
            .map((s) => {
              const requests = data.interventions.filter(
                (i) => i.site_id === s.id,
              );
              const spent = data.quotes
                .filter(
                  (q) =>
                    q.status === "accepted" &&
                    requests.some((i) => i.id === q.intervention_id),
                )
                .reduce((sum, q) => sum + q.total_cents, 0);
              const pct = s.budget_cents
                ? Math.min(100, Math.round((spent / s.budget_cents) * 100))
                : 0;
              const vertical = s.type || s.vertical || "syndic";
              return (
                <section className="panel site-panel" key={s.id}>
                  <div className="site-top">
                    <span className="service-icon">
                      <Icon name="building" size={26} />
                    </span>
                    <span className="vertical-tag">
                      {{
                        syndic: "Copropriété",
                        restaurant: "Restauration",
                        office: "Bureaux",
                        erp: "ERP",
                      }[vertical] || vertical}
                    </span>
                  </div>
                  <h2>{s.name}</h2>
                  <p className="site-address">
                    <Icon name="location" size={15} />
                    {s.address}
                  </p>
                  <div className="site-budget">
                    <div>
                      <span>Devis acceptés affichés</span>
                      <strong>{money(spent)}</strong>
                    </div>
                    <div className="budget-bar">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <small>
                      {s.budget_cents
                        ? `Budget indicatif : ${money(s.budget_cents)} — ${pct} % engagés`
                        : "Aucun budget renseigné"}
                    </small>
                  </div>
                  <p className="form-note">
                    Calcul sur les dossiers chargés. Le rapport fournit la vue
                    consolidée.
                  </p>
                  <div className="site-details">
                    <span>
                      {
                        requests.filter(
                          (i) => !["paid", "cancelled"].includes(i.status),
                        ).length
                      }{" "}
                      intervention(s) en cours affichée(s)
                    </span>
                    <span>
                      {vertical === "restaurant"
                        ? "Équipements critiques"
                        : vertical === "office"
                          ? "Maintenance et éclairage"
                          : vertical === "erp"
                            ? "Audits et sécurité"
                            : "Parties communes et équipements"}
                    </span>
                  </div>
                  <button
                    className="text-button budget-edit"
                    disabled={busy}
                    onClick={() => {
                      const amount = window.prompt(
                        "Budget de référence du site en euros :",
                        String((s.budget_cents || 0) / 100),
                      );
                      if (amount === null) return;
                      void run(async () => {
                        const budget = Math.round(
                          Number(amount.replace(",", ".")) * 100,
                        );
                        if (
                          !Number.isSafeInteger(budget) ||
                          budget < 0 ||
                          budget > 100000000
                        )
                          throw new Error(
                            "Renseignez un budget compris entre 0 et 1 000 000 €.",
                          );
                        if (mode === "demo")
                          saveDemo({
                            ...data,
                            sites: data.sites.map((site) =>
                              site.id === s.id
                                ? { ...site, budget_cents: budget }
                                : site,
                            ),
                          });
                        else {
                          await api("/api/professional", {
                            action: "set_site_budget",
                            site_id: s.id,
                            budget_cents: budget,
                          });
                          await refresh();
                        }
                        setNotice("Budget de référence mis à jour.");
                      });
                    }}
                  >
                    Modifier le budget
                  </button>
                  <div className="site-actions">
                    <button
                      className="button outline"
                      onClick={() => {
                        setSiteFilter(s.id);
                        setFilter("all");
                        go("requests");
                      }}
                    >
                      Interventions
                    </button>
                    <button
                      className="button primary"
                      onClick={() => newRequest()}
                    >
                      <Icon name="plus" size={16} />
                      Demande
                    </button>
                  </div>
                </section>
              );
            })}
        </div>
        <SiteForm
          busy={busy}
          onSubmit={async (values) => {
            await run(async () => {
              if (mode === "demo")
                saveDemo({
                  ...data,
                  sites: [...data.sites, { ...values, id: uid() }],
                });
              else {
                await api("/api/sites", values);
                await refresh();
              }
              setNotice("Site enregistré.");
            });
          }}
        />
        <ProfessionalOperations
          data={professional}
          sites={data.sites}
          organizations={data.organizations}
          quotes={data.quotes}
          demo={mode === "demo"}
          busy={busy}
          onRefresh={loadProfessional}
          onSave={async (values) => {
            return await run(async () => {
              if (mode === "demo") {
                const action = values.action;
                let next = professional;
                if (action === "set_approval_rule") {
                  const rule = {
                    id: uid(),
                    site_id: String(values.site_id),
                    threshold_cents: Number(values.threshold_cents),
                    required_role: String(values.required_role),
                    enabled: Boolean(values.enabled),
                  };
                  next = {
                    ...professional,
                    approval_rules: [
                      ...professional.approval_rules.filter(
                        (r) => r.site_id !== rule.site_id,
                      ),
                      rule,
                    ],
                  };
                }
                if (action === "decide_approval")
                  next = {
                    ...professional,
                    approvals: professional.approvals.map((a) =>
                      a.id === values.approval_id
                        ? {
                            ...a,
                            status: String(values.decision),
                            note: String(values.note || ""),
                          }
                        : a,
                    ),
                  };
                if (action === "save_contract")
                  next = {
                    ...professional,
                    contracts: [
                      ...professional.contracts.filter(
                        (c) => c.id !== values.id,
                      ),
                      {
                        ...values,
                        id: values.id || uid(),
                      } as unknown as Contract,
                    ],
                  };
                if (action === "save_compliance")
                  next = {
                    ...professional,
                    compliance_records: [
                      ...professional.compliance_records.filter(
                        (r) => r.id !== values.id,
                      ),
                      {
                        ...values,
                        id: values.id || uid(),
                      } as unknown as ComplianceRecord,
                    ],
                  };
                setProfessional(next);
              } else {
                await api("/api/professional", values);
                await loadProfessional();
              }
              setNotice(
                mode === "demo"
                  ? "Modification enregistrée dans la démonstration."
                  : "Modification enregistrée.",
              );
            });
          }}
        />
        <div className="inline-note">
          <Icon name="help" />
          <p>
            Les budgets sont des repères de gestion. Les SLA contractuels,
            approbations avancées et obligations réglementaires doivent être
            configurés avant exploitation.
          </p>
        </div>
      </>
    );
  }
  function ProfileView() {
    return (
      <>
        <PageTitle
          title="Mon profil"
          subtitle="Vos informations de compte et votre espace de travail."
        />
        <div className="detail-grid">
          <ProfileForm
            name={mode === "demo" ? name : profile?.full_name || ""}
            phone={profile?.phone || ""}
            role={role}
            demo={mode === "demo"}
            busy={busy}
            onSubmit={async (values) => {
              await run(async () => {
                if (mode === "demo") {
                  saveDemo({
                    ...data,
                    profile: {
                      id: `demo-${role}`,
                      role,
                      full_name: values.full_name,
                      phone: values.phone,
                    },
                  });
                  setNotice(
                    "Profil de démonstration enregistré dans ce navigateur. Aucune donnée n’est transmise.",
                  );
                } else {
                  await api("/api/profile", values, "PATCH");
                  await refresh();
                  setNotice("Profil mis à jour.");
                }
              });
            }}
          />
          <aside>
            <section className="panel compact-panel">
              <Icon name="shield" size={28} />
              <h2>Un accès adapté à votre rôle</h2>
              <p>
                Votre espace : {ROLE_NAMES[role]}. Les droits sont contrôlés
                côté serveur.
              </p>
              {role === "artisan" && (
                <p>
                  {mode === "demo"
                    ? "Artisan de démonstration."
                    : profile?.artisan_approved
                      ? "Candidature approuvée."
                      : "Candidature en attente de validation. Vous ne pouvez pas encore accepter de mission."}
                </p>
              )}
            </section>
            {role === "artisan" && (
              <button
                className="button primary full"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (mode === "demo") {
                      setNotice(
                        "Le parcours Stripe Connect nécessite un compte artisan réel approuvé. Aucun compte bancaire n’est créé dans la démonstration.",
                      );
                      return;
                    }
                    const result = await api<{ url: string }>(
                      "/api/payments/connect",
                      {},
                    );
                    if (!result.url?.startsWith("https://"))
                      throw new Error("Le lien Stripe n’est pas disponible.");
                    window.location.assign(result.url);
                  })
                }
              >
                <Icon name="euro" />
                Configurer mes règlements Stripe
              </button>
            )}
            <button
              className="button outline full"
              onClick={() => void logout()}
            >
              <Icon name="logout" />
              Se déconnecter
            </button>
          </aside>
        </div>
      </>
    );
  }
  function Help() {
    return (
      <>
        <PageTitle
          title="Un dépannage, étape par étape."
          subtitle="Comprendre votre demande, votre devis et votre paiement."
        />
        <div className="help-layout">
          <section className="panel faq-panel">
            <h2>Questions fréquentes</h2>
            {[
              [
                "Quelle différence entre estimation et devis ?",
                "L’estimation donne une fourchette indicative. Le devis est établi par l’artisan à partir de votre besoin et détaille les prestations, les taxes et le montant proposé. Vous le validez avant le début des travaux.",
              ],
              [
                "Quand dois-je régler l’intervention ?",
                "Le paiement est proposé une fois l’intervention terminée, sur la base du devis accepté. Le règlement est traité avec Stripe. Une redirection de paiement ne suffit pas à confirmer son encaissement.",
              ],
              [
                "Comment suivre ma demande ?",
                "Dans « Mes demandes », ouvrez une intervention pour consulter son état, son devis et les échanges associés.",
              ],
              [
                "Comment sont attribuées les missions ?",
                "Un artisan éligible accepte une demande disponible. L’attribution est contrôlée pour qu’une même mission ne soit pas acceptée par plusieurs artisans. Aucun délai n’est garanti à ce stade.",
              ],
              [
                "Que couvre la garantie prévue ?",
                "Le projet prévoit un suivi de garantie d’un an. Ses conditions commerciales et son périmètre doivent être définis avant le lancement réel. Aucune couverture supplémentaire n’est promise dans cette version.",
              ],
              [
                "Puis-je gérer plusieurs établissements ?",
                "L’espace professionnel regroupe les sites et leurs interventions. Il distingue copropriétés, restauration, bureaux et établissements recevant du public.",
              ],
              [
                "Puis-je tester sans transmettre mes informations ?",
                "Oui. La démonstration utilise des exemples et conserve ses modifications dans ce navigateur. Elle n’envoie aucune demande à un artisan et ne réalise aucun débit bancaire.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </section>
          <aside>
            <section className="help-panel">
              <Icon name="help" size={30} />
              <h2>Besoin d’une intervention ?</h2>
              <p>
                Commencez par décrire le problème. Vous pourrez préciser le lieu
                et votre besoin.
              </p>
              <button
                className="button primary full"
                onClick={() => newRequest()}
              >
                Créer une demande
              </button>
            </section>
            <section className="panel compact-panel">
              <h3>Contact et informations légales</h3>
              <p>
                Les coordonnées de l’exploitant, les conditions de service et
                les mentions légales seront publiées avant l’ouverture
                commerciale.
              </p>
              <p>Cette version ne fournit pas de ligne d’urgence.</p>
            </section>
          </aside>
        </div>
      </>
    );
  }
  function Auth() {
    return (
      <AuthForm
        mode={authMode}
        onMode={setAuthMode}
        busy={busy}
        onSubmit={async (values) => {
          await run(async () => {
            const client = createClient();
            if (authMode === "signup") {
              const result = await client.auth.signUp({
                email: values.email,
                password: values.password,
                options: {
                  data: { full_name: values.full_name, role: values.role },
                },
              });
              if (result.error) throw result.error;
              if (result.data.session) {
                await refresh();
                go(pendingDraft ? "new" : "overview");
              } else
                setNotice(
                  "Votre compte a été créé. Consultez votre email pour confirmer votre inscription avant de vous connecter.",
                );
            } else if (authMode === "reset") {
              const result = await client.auth.resetPasswordForEmail(
                values.email,
                { redirectTo: window.location.origin + "/auth/reset-password" },
              );
              if (result.error) throw result.error;
              setNotice(
                "Si un compte existe pour cette adresse, un lien de réinitialisation vous sera envoyé.",
              );
            } else {
              const result = await client.auth.signInWithPassword({
                email: values.email,
                password: values.password,
              });
              if (result.error)
                throw new Error(
                  "Connexion impossible. Vérifiez votre email, votre mot de passe et la confirmation de votre compte.",
                );
              await refresh();
              go(pendingDraft ? "new" : "overview");
            }
          });
        }}
        onDemo={() => demo()}
      />
    );
  }
  function Admin() {
    return (
      <>
        <PageTitle
          title="Administration"
          subtitle="Vérifiez les candidatures avant l’accès aux missions."
        />
        <ArtisanAdministration demo={mode === "demo"} />
        <WarrantyPanel demo={mode === "demo"} role={role} />
      </>
    );
  }
  if (mode === "public")
    return (
      <>
        <div className="public-alerts">
          <Alerts />
        </div>
        {renderPublic()}
      </>
    );
  return (
    <div className="application">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <button className="brand-button" onClick={() => go("overview")}>
          <Brand />
        </button>
        <button
          className="sidebar-close"
          aria-label="Fermer le menu"
          onClick={() => setMobile(false)}
        >
          <Icon name="close" />
        </button>
        <div className="workspace-selector">
          <span className="workspace-avatar">
            <Icon
              name={
                role === "manager"
                  ? "building"
                  : role === "artisan"
                    ? "wrench"
                    : "person"
              }
              size={20}
            />
          </span>
          <div>
            <strong>{ROLE_NAMES[role]}</strong>
            <span>
              {mode === "demo"
                ? "Espace de démonstration"
                : "Mon espace personnel"}
            </span>
          </div>
        </div>
        <span className="nav-caption">Mon espace</span>
        <nav aria-label="Navigation de l’espace">
          {nav.map((n) => (
            <button
              key={n.id}
              className={
                view === n.id || (view === "detail" && n.id === "requests")
                  ? "active"
                  : ""
              }
              onClick={() => go(n.id)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.count ? <small>{n.count}</small> : null}
            </button>
          ))}
        </nav>
        {mode === "demo" && (
          <div className="demo-role">
            <label htmlFor="demo-role">Explorer un autre espace</label>
            <select
              id="demo-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setSiteFilter("all");
                go("overview");
              }}
            >
              <option value="client">Particulier</option>
              <option value="artisan">Artisan électricien</option>
              <option value="manager">Professionnel / syndic</option>
              <option value="admin">Administration (démo uniquement)</option>
            </select>
            <small>Exemples fictifs, conservés dans ce navigateur.</small>
          </div>
        )}
        <div className="sidebar-bottom">
          <button
            className={view === "help" ? "active" : ""}
            onClick={() => go("help")}
          >
            <Icon name="help" />
            Aide et informations
          </button>
          <button
            className={view === "profile" ? "active" : ""}
            onClick={() => go("profile")}
          >
            <Icon name="person" />
            Mon profil
          </button>
          <button onClick={() => void logout()}>
            <Icon name="logout" />
            {mode === "demo" ? "Quitter la démonstration" : "Se déconnecter"}
          </button>
          <div className="sidebar-footnote">
            <span className="tiny-mark">C.</span>
            <span>
              Chaque intervention,
              <br />
              en toute clarté.
            </span>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-overlay"
          aria-label="Fermer le menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="workspace-main">
        <header className="app-header">
          <div>
            <button
              className="mobile-menu"
              aria-label="Ouvrir le menu"
              onClick={() => setMobile(true)}
            >
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">
              Mon espace
              <Icon name="arrow" size={13} />
              <strong>{VIEW_NAMES[view]}</strong>
            </span>
          </div>
          <div className="header-user">
            {mode === "live" && (
              <button
                className={`connection-state ${connection === "SUBSCRIBED" ? "connected" : ""}`}
                onClick={() => void refresh()}
                title="Actualiser les données"
              >
                <span />
                {connection === "SUBSCRIBED" ? "En direct" : "Actualiser"}
              </button>
            )}
            <button
              className="notification-button"
              aria-label="Voir les messages"
              onClick={() => go("messages")}
            >
              <Icon name="bell" size={20} />
              {data.messages.length > 0 && <span />}
            </button>
            <button className="user-button" onClick={() => go("profile")}>
              <span className="avatar">
                {name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{name}</strong>
                <small>{ROLE_NAMES[role]}</small>
              </span>
            </button>
          </div>
        </header>
        {mode === "demo" && (
          <div className="demo-banner">
            <span>
              <Icon name="help" size={16} />
              <strong>Démonstration</strong> — données fictives. Aucun artisan
              contacté, aucun débit bancaire.
            </span>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Réinitialiser toutes les données de démonstration ?",
                  )
                ) {
                  saveDemo(seed());
                  setProfessional(proSeed());
                  try {
                    localStorage.removeItem("courant-warranty-demo-v1");
                    localStorage.removeItem("courant-admin-demo-v1");
                  } catch {}
                  setNotice("Démonstration réinitialisée.");
                }
              }}
            >
              Réinitialiser
            </button>
          </div>
        )}
        <main id="main" className="workspace-content">
          <Alerts />
          {loading ? (
            <div className="page-loader">
              <span className="spinner" />
              Chargement de votre espace…
            </div>
          ) : view === "overview" ? (
            Overview()
          ) : view === "requests" || view === "missions" ? (
            Requests()
          ) : view === "new" ? (
            NewRequest()
          ) : view === "detail" ? (
            Detail()
          ) : view === "messages" ? (
            MessagesView()
          ) : view === "documents" ? (
            Documents()
          ) : view === "sites" ? (
            Sites()
          ) : view === "profile" ? (
            ProfileView()
          ) : view === "admin" ? (
            Admin()
          ) : view === "auth" ? (
            Auth()
          ) : (
            Help()
          )}
          {mode === "live" && error && (
            <button
              className="button outline retry-button"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" />
              Recharger les données
            </button>
          )}
        </main>
        <footer className="app-footer">
          <span>Courant — nom de travail</span>
          <button onClick={() => go("help")}>
            Aide et informations légales
          </button>
        </footer>
      </div>
    </div>
  );
}

type RequestValues = {
  category: Category;
  description: string;
  address: string;
  postal_code: string;
  city: string;
  urgency: "urgent" | "scheduled";
  site_id?: string;
};
function RequestForm({
  initialCategory,
  initialValues,
  sites,
  mode,
  busy,
  onBack,
  onSubmit,
  onDemo,
}: {
  initialCategory: Category;
  initialValues: RequestValues | null;
  sites: Site[];
  mode: string;
  busy: boolean;
  onBack: () => void;
  onSubmit: (values: RequestValues) => Promise<void>;
  onDemo: () => void;
}) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<RequestValues>(
    initialValues || {
      category: initialCategory,
      description: "",
      address: "",
      postal_code: "",
      city: "",
      urgency: "scheduled",
    },
  );
  const [validation, setValidation] = useState("");
  const c = category(values.category);
  function next(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidation("");
    if (step === 1 && values.description.trim().length < 15) {
      setValidation("Décrivez le problème en au moins 15 caractères.");
      return;
    }
    if (step < 3) setStep(step + 1);
    else void onSubmit(values);
  }
  return (
    <div className="form-page">
      <button className="back-link" onClick={onBack}>
        <Icon name="back" size={17} />
        Retour
      </button>
      <div className="form-heading">
        <h1>Créons votre demande.</h1>
        <p>Le bon point de départ pour résoudre votre problème électrique.</p>
      </div>
      <ol className="stepper">
        {["Le problème", "Le lieu et le besoin", "Le récapitulatif"].map(
          (s, i) => (
            <li key={s} className={step >= i + 1 ? "current" : ""}>
              <span>
                {step > i + 1 ? <Icon name="check" size={15} /> : i + 1}
              </span>
              <strong>{s}</strong>
            </li>
          ),
        )}
      </ol>
      <form className="panel request-form" onSubmit={next}>
        {validation && (
          <div className="alert error" role="alert">
            {validation}
          </div>
        )}
        {step === 1 ? (
          <>
            <h2>Que se passe-t-il ?</h2>
            <div className="category-grid">
              {CATEGORIES.map((cat) => (
                <button
                  type="button"
                  className={values.category === cat.id ? "selected" : ""}
                  key={cat.id}
                  onClick={() => setValues({ ...values, category: cat.id })}
                >
                  <Icon name={cat.icon} size={25} />
                  <span>
                    <strong>{cat.label}</strong>
                    <small>{cat.description}</small>
                  </span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            <Field
              label="Décrivez le problème"
              hint="Ce que vous constatez, les pièces concernées et depuis quand. 15 caractères minimum."
            >
              <textarea
                value={values.description}
                required
                minLength={15}
                maxLength={2000}
                rows={4}
                placeholder="Par exemple : le disjoncteur se déclenche depuis ce matin lorsque j’allume le four…"
                onChange={(e) =>
                  setValues({ ...values, description: e.target.value })
                }
              />
            </Field>
            <div className="inline-note">
              <Icon name="shield" />
              <p>
                Ne manipulez pas une installation qui présente un danger. Cette
                application ne fournit pas de diagnostic d’urgence.
              </p>
            </div>
          </>
        ) : step === 2 ? (
          <>
            <h2>Où faut-il intervenir ?</h2>
            {sites.length > 0 && (
              <Field label="Site professionnel (facultatif)">
                <select
                  value={values.site_id || ""}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      site_id: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Adresse personnelle ou autre lieu</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Adresse d’intervention">
              <input
                required
                minLength={5}
                maxLength={250}
                autoComplete="street-address"
                value={values.address}
                onChange={(e) =>
                  setValues({ ...values, address: e.target.value })
                }
                placeholder="Numéro et nom de rue"
              />
            </Field>
            <div className="form-columns">
              <Field label="Code postal">
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{5}"
                  maxLength={5}
                  autoComplete="postal-code"
                  value={values.postal_code}
                  onChange={(e) =>
                    setValues({ ...values, postal_code: e.target.value })
                  }
                />
              </Field>
              <Field label="Ville">
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="address-level2"
                  value={values.city}
                  onChange={(e) =>
                    setValues({ ...values, city: e.target.value })
                  }
                />
              </Field>
            </div>
            <fieldset className="urgency-options">
              <legend>Quel est votre besoin ?</legend>
              {[
                [
                  "scheduled",
                  "Intervention à planifier",
                  "Le problème peut attendre un rendez-vous.",
                ],
                [
                  "urgent",
                  "Demande urgente",
                  "Le problème nécessite une prise en charge prioritaire.",
                ],
              ].map(([id, label, desc]) => (
                <label
                  key={id}
                  className={values.urgency === id ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="urgency"
                    value={id}
                    checked={values.urgency === id}
                    onChange={() =>
                      setValues({
                        ...values,
                        urgency: id as "urgent" | "scheduled",
                      })
                    }
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="form-note">
              La disponibilité et les délais seront précisés après prise en
              charge. Aucune affectation immédiate n’est garantie.
            </p>
          </>
        ) : (
          <>
            <h2>Votre demande, en clair.</h2>
            <div className="recap-service">
              <span className="service-icon">
                <Icon name={c.icon} size={27} />
              </span>
              <div>
                <strong>{c.label}</strong>
                <span>
                  {values.urgency === "urgent"
                    ? "Demande urgente"
                    : "Intervention à planifier"}
                </span>
              </div>
            </div>
            <p>{values.description}</p>
            <div className="recap-address">
              <Icon name="location" />
              <span>
                {values.address}
                <br />
                {values.postal_code} {values.city}
              </span>
            </div>
            <div className="estimate-box">
              <span>Estimation indicative</span>
              <strong>
                {money(c.min)} – {money(c.max)}
              </strong>
              <p>
                Ces montants sont des exemples de préparation du service. Le
                prix final et les taxes applicables seront précisés dans un
                devis à accepter avant intervention.
              </p>
            </div>
            {mode === "public" && (
              <div className="alert warning">
                <Icon name="lock" />
                <span>
                  Un compte est nécessaire pour enregistrer et suivre votre
                  demande. Vous pourrez aussi explorer une démonstration sans
                  envoyer de demande réelle.
                </span>
              </div>
            )}
            {mode === "demo" && (
              <div className="alert warning">
                <Icon name="help" />
                <span>
                  Cette demande restera dans la démonstration. Ne saisissez pas
                  de données personnelles réelles.
                </span>
              </div>
            )}
          </>
        )}
        <div className="form-actions">
          {step > 1 ? (
            <button
              type="button"
              className="button outline"
              onClick={() => setStep(step - 1)}
            >
              <Icon name="back" size={16} />
              Précédent
            </button>
          ) : (
            <span />
          )}
          <button type="submit" className="button primary" disabled={busy}>
            {busy
              ? "Enregistrement…"
              : step < 3
                ? "Continuer"
                : mode === "public"
                  ? "Créer mon compte et continuer"
                  : "Enregistrer la demande"}
            {!busy && <Icon name="arrow" size={16} />}
          </button>
        </div>
        {mode === "public" && step === 3 && (
          <button type="button" className="text-button full" onClick={onDemo}>
            Essayer d’abord la démonstration
          </button>
        )}
      </form>
    </div>
  );
}
function QuoteEditor({
  busy,
  demo,
  onSubmit,
}: {
  busy: boolean;
  demo: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}) {
  const [lines, setLines] = useState<Line[]>([
    { label: "Déplacement", quantity: 1, unit_price_cents: 0 },
    { label: "Main-d’œuvre", quantity: 1, unit_price_cents: 0 },
  ]);
  const [tax, setTax] = useState(20);
  const [err, setErr] = useState("");
  const subtotal = lines.reduce(
    (n, l) => n + Math.round(l.quantity * l.unit_price_cents),
    0,
  );
  return (
    <form
      className="panel quote-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (
          lines.some(
            (l) =>
              !l.label.trim() ||
              !Number.isInteger(l.quantity) ||
              l.quantity <= 0 ||
              l.unit_price_cents < 0,
          ) ||
          subtotal <= 0
        ) {
          setErr(
            "Renseignez les prestations, les quantités et un montant total supérieur à zéro.",
          );
          return;
        }
        setErr("");
        onSubmit({ lines, tax_rate: tax });
      }}
    >
      <h2>Établir le devis</h2>
      <p>Détaillez les prestations et vérifiez les taxes applicables.</p>
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
      {lines.map((l, index) => (
        <div className="quote-editor-row" key={index}>
          <Field label={`Prestation ${index + 1}`}>
            <input
              required
              maxLength={150}
              value={l.label}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index ? { ...x, label: e.target.value } : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Quantité">
            <input
              required
              type="number"
              min="1"
              max="1000"
              step="1"
              value={l.quantity}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index
                      ? { ...x, quantity: Number(e.target.value) }
                      : x,
                  ),
                )
              }
            />
          </Field>
          <Field label="Prix unitaire HT (€)">
            <input
              required
              type="number"
              min="0"
              max="100000"
              step="0.01"
              value={l.unit_price_cents / 100}
              onChange={(e) =>
                setLines(
                  lines.map((x, j) =>
                    j === index
                      ? {
                          ...x,
                          unit_price_cents: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        }
                      : x,
                  ),
                )
              }
            />
          </Field>
          <button
            className="icon-button"
            type="button"
            disabled={lines.length === 1}
            aria-label={`Supprimer la prestation ${index + 1}`}
            onClick={() => setLines(lines.filter((_, j) => j !== index))}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setLines([...lines, { label: "", quantity: 1, unit_price_cents: 0 }])
        }
      >
        <Icon name="plus" size={17} />
        Ajouter une ligne
      </button>
      <Field
        label="Taux de TVA (%)"
        hint={
          demo
            ? "Taux de démonstration, sans validation fiscale."
            : "Renseignez le taux applicable à votre prestation."
        }
      >
        <select value={tax} onChange={(e) => setTax(Number(e.target.value))}>
          <option value="0">0 %</option>
          <option value="5.5">5,5 %</option>
          <option value="10">10 %</option>
          <option value="20">20 %</option>
        </select>
      </Field>
      <div className="quote-totals">
        <div>
          <span>Total HT</span>
          <strong>{money(subtotal)}</strong>
        </div>
        <div className="total">
          <span>Total TTC</span>
          <strong>
            {money(subtotal + Math.round((subtotal * tax) / 100))}
          </strong>
        </div>
      </div>
      <button type="submit" className="button primary full" disabled={busy}>
        <Icon name="send" />
        {busy ? "Envoi…" : "Envoyer le devis"}
      </button>
    </form>
  );
}
function MessageCenter({
  interventions,
  messages,
  role,
  profileId,
  selectedId,
  busy,
  onSubmit,
}: {
  interventions: Intervention[];
  messages: Message[];
  role: Role;
  profileId: string;
  selectedId: string;
  busy: boolean;
  onSubmit: (id: string, body: string) => Promise<boolean | undefined>;
}) {
  const [id, setId] = useState(selectedId || interventions[0]?.id || "");
  const [body, setBody] = useState("");
  const rows = messages.filter((m) => m.intervention_id === id);
  return (
    <section className="panel messages-layout">
      <div className="message-threads">
        <h2>Interventions</h2>
        {interventions.map((i) => (
          <button
            key={i.id}
            className={id === i.id ? "selected" : ""}
            onClick={() => setId(i.id)}
          >
            <Icon name={category(i.category).icon} />
            <span>
              <strong>{category(i.category).label}</strong>
              <small>{shortId(i.id)}</small>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
      <div className="message-conversation">
        {!id ? (
          <Empty icon="message" title="Aucune conversation">
            Vos échanges seront disponibles une fois une demande créée.
          </Empty>
        ) : (
          <>
            <div className="conversation-header">
              <h2>
                {
                  category(
                    interventions.find((i) => i.id === id)?.category || "",
                  ).label
                }
              </h2>
              <span>Conversation liée à l’intervention</span>
            </div>
            <div className="message-history" aria-live="polite">
              {rows.length ? (
                rows.map((m) => (
                  <div
                    className={`message-bubble ${m.author_id === profileId ? "mine" : ""}`}
                    key={m.id}
                  >
                    <span>
                      {m.author_id === profileId
                        ? "Vous"
                        : role === "artisan"
                          ? "Client"
                          : "Artisan"}
                    </span>
                    <p>{m.body}</p>
                    <small>{date(m.created_at)}</small>
                  </div>
                ))
              ) : (
                <Empty icon="message" title="Commencez l’échange">
                  Posez une question sur cette intervention.
                </Empty>
              )}
            </div>
            <form
              className="message-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (body.trim()) {
                  void onSubmit(id, body.trim()).then((saved) => {
                    if (saved) setBody("");
                  });
                }
              }}
            >
              <label className="sr-only" htmlFor="message-body">
                Votre message
              </label>
              <textarea
                id="message-body"
                required
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Écrivez votre message…"
                rows={2}
              />
              <button
                className="button primary"
                disabled={busy || !body.trim()}
                type="submit"
                aria-label="Envoyer le message"
              >
                <Icon name="send" />
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
function SiteForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (values: {
    name: string;
    type: string;
    address: string;
    budget_cents: number;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState("syndic");
  const [budget, setBudget] = useState("");
  return (
    <section className="panel site-form">
      <div className="section-heading">
        <div>
          <h2>Ajouter un site</h2>
          <p>Un lieu et un budget de référence pour vos interventions.</p>
        </div>
        <button className="button outline" onClick={() => setOpen(!open)}>
          <Icon name={open ? "close" : "plus"} />
          {open ? "Fermer" : "Nouveau site"}
        </button>
      </div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit({
              name,
              address,
              type,
              budget_cents: Math.round(Number(budget || 0) * 100),
            });
          }}
        >
          <div className="form-columns">
            <Field label="Nom du site">
              <input
                required
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Type de site">
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="syndic">Syndic / copropriété</option>
                <option value="restaurant">Restauration</option>
                <option value="office">Bureaux</option>
                <option value="erp">ERP</option>
              </select>
            </Field>
          </div>
          <Field label="Adresse">
            <input
              required
              minLength={5}
              maxLength={250}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>
          <Field label="Budget de référence (€)">
            <input
              type="number"
              min="0"
              step="0.01"
              max="1000000"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer le site"}
          </button>
        </form>
      )}
    </section>
  );
}
function ProfileForm({
  name,
  phone,
  role,
  demo,
  busy,
  onSubmit,
}: {
  name: string;
  phone: string;
  role: Role;
  demo: boolean;
  busy: boolean;
  onSubmit: (values: { full_name: string; phone: string }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState(name);
  const [number, setNumber] = useState(phone);
  return (
    <form
      className="panel profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ full_name: fullName, phone: number });
      }}
    >
      <div className="profile-intro">
        <span className="avatar large-avatar">
          {fullName
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div>
          <h2>{name}</h2>
          <p>
            {ROLE_NAMES[role]}
            {demo ? " — démonstration" : ""}
          </p>
        </div>
      </div>
      <Field label="Nom complet">
        <input
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>
      <Field label="Téléphone (facultatif)">
        <input
          type="tel"
          maxLength={30}
          autoComplete="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="Votre numéro de téléphone"
        />
      </Field>
      <p className="form-note">
        Votre rôle et l’approbation d’une candidature artisan ne peuvent pas
        être modifiés depuis ce formulaire.
      </p>
      <button className="button primary" disabled={busy} type="submit">
        {busy ? "Enregistrement…" : "Enregistrer les informations"}
      </button>
    </form>
  );
}
function AuthForm({
  mode,
  onMode,
  busy,
  onSubmit,
  onDemo,
}: {
  mode: "login" | "signup" | "reset";
  onMode: (mode: "login" | "signup" | "reset") => void;
  busy: boolean;
  onSubmit: (values: {
    email: string;
    password: string;
    full_name: string;
    role: Role;
  }) => Promise<void>;
  onDemo: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("client");
  return (
    <div className="auth-layout">
      <section className="auth-copy">
        <span className="auth-mark">
          <Icon name="bolt" size={52} />
        </span>
        <h1>
          Votre intervention,
          <br />
          en toute clarté.
        </h1>
        <p>
          Retrouvez vos demandes, vos devis et vos échanges dans un même espace.
        </p>
        <button className="text-button" onClick={onDemo}>
          Explorer sans créer de compte
          <Icon name="arrow" size={16} />
        </button>
      </section>
      <form
        className="panel auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ email, password, full_name: name, role });
        }}
      >
        <h2>
          {mode === "login"
            ? "Connexion"
            : mode === "signup"
              ? "Créer un compte"
              : "Réinitialiser mon mot de passe"}
        </h2>
        <p>
          {mode === "login"
            ? "Ravi de vous retrouver."
            : mode === "signup"
              ? "Choisissez l’espace qui correspond à votre besoin."
              : "Recevez un lien pour choisir un nouveau mot de passe."}
        </p>
        {mode === "signup" && (
          <>
            <Field label="Votre espace">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="client">Particulier</option>
                <option value="artisan">Artisan électricien</option>
                <option value="manager">Professionnel / syndic</option>
              </select>
            </Field>
            <Field label="Nom complet">
              <input
                required
                autoComplete="name"
                minLength={2}
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {role === "artisan" && (
              <div className="inline-note">
                <Icon name="shield" />
                <p>
                  Votre candidature devra être approuvée avant que vous puissiez
                  accepter des missions.
                </p>
              </div>
            )}
          </>
        )}
        <Field label="Adresse email">
          <input
            required
            type="email"
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {mode !== "reset" && (
          <Field
            label="Mot de passe"
            hint={mode === "signup" ? "Au moins 10 caractères." : undefined}
          >
            <input
              required
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={mode === "signup" ? 10 : 1}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        {mode === "login" && (
          <button
            type="button"
            className="forgot-link"
            onClick={() => onMode("reset")}
          >
            Mot de passe oublié ?
          </button>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          {busy
            ? "Veuillez patienter…"
            : mode === "login"
              ? "Se connecter"
              : mode === "signup"
                ? "Créer mon compte"
                : "Envoyer le lien"}
        </button>
        <p className="auth-switch">
          {mode === "login"
            ? "Pas encore de compte ?"
            : mode === "signup"
              ? "Déjà un compte ?"
              : "Vous vous souvenez du mot de passe ?"}{" "}
          <button
            type="button"
            onClick={() => onMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Créer un compte" : "Se connecter"}
          </button>
        </p>
        <p className="form-note">
          Aucun paiement n’est demandé à l’inscription.
        </p>
      </form>
    </div>
  );
}

function ReviewForm({
  existing,
  enabled,
  busy,
  onSubmit,
}: {
  existing?: Review;
  enabled: boolean;
  busy: boolean;
  onSubmit: (values: { rating: number; body: string }) => Promise<void>;
}) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  if (existing)
    return (
      <section className="panel review-panel">
        <h2>Votre avis</h2>
        <p className="review-stars" aria-label={`${existing.rating} sur 5`}>
          {"★".repeat(existing.rating)}
          {"☆".repeat(5 - existing.rating)}
        </p>
        <p>{existing.body || "Merci pour votre évaluation."}</p>
      </section>
    );
  if (!enabled) return null;
  return (
    <form
      className="panel review-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ rating, body });
      }}
    >
      <h2>Comment s’est passée l’intervention ?</h2>
      <p>Votre retour porte sur cette intervention terminée et réglée.</p>
      <fieldset className="rating-options">
        <legend>Votre note sur cinq</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n}>
            <input
              type="radio"
              name="rating"
              value={n}
              checked={rating === n}
              onChange={() => setRating(n)}
            />
            <span>
              {n}
              <Icon name="star" size={15} />
            </span>
          </label>
        ))}
      </fieldset>
      <Field label="Votre commentaire (facultatif)">
        <textarea
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ce qui vous a été utile, ce qui pourrait être amélioré…"
        />
      </Field>
      <button className="button primary" type="submit" disabled={busy}>
        Enregistrer mon avis
      </button>
    </form>
  );
}
function DocumentManager({
  documents,
  interventions,
  demo,
  onRefresh,
}: {
  documents: StoredDocument[];
  interventions: Intervention[];
  demo: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || demo) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size > 4194304)
        throw new Error("Choisissez un document de moins de 4 Mo.");
      if (
        !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
          file.type,
        )
      )
        throw new Error("Formats autorisés : PDF, JPEG, PNG et WebP.");
      const form = new FormData();
      form.append("file", file);
      if (selected) form.append("intervention_id", selected);
      const response = await fetch("/api/documents", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Le document n’a pas pu être enregistré.",
        );
      await onRefresh();
      setNotice("Document enregistré dans votre espace privé.");
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel document-manager">
      <div className="section-heading">
        <h2>Pièces et justificatifs</h2>
        <Icon name="lock" />
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {documents.length ? (
        <div className="document-list">
          {documents.map((d) => (
            <div key={d.id}>
              <Icon name="document" />
              <section>
                <h3>{d.name}</h3>
                <p>{date(d.created_at)}</p>
              </section>
              <button
                className="button outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api<{ url: string }>(
                      `/api/documents?id=${encodeURIComponent(d.id)}`,
                    );
                    if (!result.url?.startsWith("https://"))
                      throw new Error(
                        "Le lien de téléchargement est indisponible.",
                      );
                    window.open(result.url, "_blank", "noopener,noreferrer");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="download" />
                Télécharger
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="document-empty">Aucune pièce jointe pour le moment.</p>
      )}
      {demo ? (
        <div className="inline-note">
          <Icon name="help" />
          <p>
            Le dépôt de documents réels est désactivé dans la démonstration.
            Connectez-vous à un compte réel pour déposer une pièce dans le
            stockage privé.
          </p>
        </div>
      ) : (
        <form onSubmit={upload}>
          <Field label="Dossier associé (facultatif)">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Justificatif personnel</option>
              {interventions.map((i) => (
                <option value={i.id} key={i.id}>
                  {shortId(i.id)} — {category(i.category).label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Document privé"
            hint="PDF, JPEG, PNG ou WebP, jusqu’à 4 Mo."
          >
            <input
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !file}
          >
            <Icon name="plus" />
            {busy ? "Enregistrement…" : "Ajouter le document"}
          </button>
        </form>
      )}
    </section>
  );
}
function ArtisanAdministration({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<(Profile & { created_at: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      if (demo) {
        const stored = localStorage.getItem("courant-admin-demo-v1");
        setRows(
          stored
            ? JSON.parse(stored)
            : [
                {
                  id: "demo-artisan",
                  full_name: "Alex Martin",
                  role: "artisan",
                  artisan_approved: true,
                  created_at: "2026-10-30T09:00:00Z",
                },
                {
                  id: "demo-artisan-2",
                  full_name: "Sam Laurent",
                  role: "artisan",
                  artisan_approved: false,
                  created_at: "2026-10-30T10:00:00Z",
                },
              ],
        );
        return;
      }
      const result = await api<{
        artisans: (Profile & { created_at: string })[];
      }>("/api/admin/artisans");
      setRows(result.artisans);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Candidatures artisans</h2>
        <button
          className="button outline"
          onClick={() => void load()}
          disabled={loading}
        >
          <Icon name="refresh" />
          Actualiser
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="page-loader">
          <span className="spinner" />
          Chargement des candidatures…
        </div>
      ) : rows.length ? (
        <div className="document-list">
          {rows.map((p) => (
            <div key={p.id}>
              <span className="avatar">
                {p.full_name.slice(0, 2).toUpperCase()}
              </span>
              <section>
                <h3>{p.full_name}</h3>
                <p>
                  {p.artisan_approved
                    ? "Candidature approuvée"
                    : "En attente de vérification"}{" "}
                  — {date(p.created_at)}
                </p>
              </section>
              <button
                className="button outline"
                disabled={Boolean(busy)}
                onClick={async () => {
                  if (
                    !window.confirm(
                      p.artisan_approved
                        ? "Suspendre l’accès aux nouvelles missions de cet artisan ?"
                        : "Confirmez-vous avoir vérifié la candidature et ses justificatifs ?",
                    )
                  )
                    return;
                  setBusy(p.id);
                  setError("");
                  try {
                    if (demo) {
                      const next = rows.map((row) =>
                        row.id === p.id
                          ? { ...row, artisan_approved: !row.artisan_approved }
                          : row,
                      );
                      localStorage.setItem(
                        "courant-admin-demo-v1",
                        JSON.stringify(next),
                      );
                      setRows(next);
                    } else {
                      await api("/api/admin/artisans", {
                        user_id: p.id,
                        approved: !p.artisan_approved,
                      });
                      await load();
                    }
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === p.id
                  ? "Enregistrement…"
                  : p.artisan_approved
                    ? "Suspendre"
                    : "Approuver"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="shield" title="Aucune candidature à vérifier">
          Les inscriptions artisans apparaîtront ici.
        </Empty>
      )}
    </section>
  );
}

function ProfessionalOperations({
  data,
  sites,
  organizations,
  quotes,
  demo,
  busy,
  onRefresh,
  onSave,
}: {
  data: ProfessionalData;
  sites: Site[];
  organizations: { id: string; name: string }[];
  quotes: Quote[];
  demo: boolean;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onSave: (values: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [tab, setTab] = useState("approvals");
  const [site, setSite] = useState("");
  const [threshold, setThreshold] = useState("200");
  const [requiredRole, setRequiredRole] = useState("manager");
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [terms, setTerms] = useState("");
  const [contractStatus, setContractStatus] = useState("draft");
  const [kind, setKind] = useState("maintenance");
  const [due, setDue] = useState("");
  const [recordStatus, setRecordStatus] = useState("pending");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const selectedSite = site || sites[0]?.id || "";
  function siteField() {
    return (
      <Field label="Site concerné">
        <select
          required
          value={selectedSite}
          onChange={(e) => setSite(e.target.value)}
        >
          <option value="" disabled>
            Choisir un site
          </option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  async function report() {
    setError("");
    try {
      if (demo) {
        const rows = [
          ["Type", "Site", "Échéance", "Statut"],
          ...data.compliance_records.map((r) => [
            r.kind,
            sites.find((s) => s.id === r.site_id)?.name || "",
            r.due_on,
            r.status,
          ]),
        ];
        download(
          "courant-suivi-demo.csv",
          "\uFEFF" +
            rows
              .map((row) =>
                row
                  .map(
                    (v) =>
                      `"${v.replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`,
                  )
                  .join(";"),
              )
              .join("\r\n"),
          "text/csv;charset=utf-8",
        );
        return;
      }
      const response = await fetch("/api/reports?format=csv", {
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Le rapport n’est pas disponible.");
      }
      download(
        "courant-rapport.csv",
        await response.text(),
        "text/csv;charset=utf-8",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel professional-operations">
      <div className="section-heading">
        <div>
          <h2>Pilotage professionnel</h2>
          <p>Approbations, contrats et échéances de vos sites.</p>
        </div>
        <button className="button outline" onClick={() => void report()}>
          <Icon name="download" />
          Rapport
        </button>
      </div>
      <div
        className="tabs operations-tabs"
        role="group"
        aria-label="Pilotage professionnel"
      >
        {[
          ["approvals", "Approbations"],
          ["contracts", "Contrats cadres"],
          ["compliance", "Audits et maintenance"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
        {!demo && (
          <button
            className="refresh-operations"
            aria-label="Actualiser le pilotage professionnel"
            onClick={() => void onRefresh()}
          >
            <Icon name="refresh" size={17} />
          </button>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {tab === "approvals" ? (
        <div className="operations-grid">
          <div>
            <h3>Décisions en attente</h3>
            {data.approvals.length ? (
              <div className="approval-list">
                {data.approvals.map((a) => {
                  const q = quotes.find((q) => q.id === a.quote_id);
                  return (
                    <div key={a.id}>
                      <section>
                        <strong>
                          {q ? money(q.total_cents) : "Devis à approuver"}
                        </strong>
                        <p>
                          {a.site_id
                            ? sites.find((s) => s.id === a.site_id)?.name
                            : "Site de l’intervention"}
                        </p>
                        <span
                          className={`badge ${a.status === "approved" ? "status-paid" : a.status === "rejected" ? "status-cancelled" : "status-quoted"}`}
                        >
                          {a.status === "approved"
                            ? "Approuvé"
                            : a.status === "rejected"
                              ? "Refusé"
                              : "En attente"}
                        </span>
                        {a.note && <p>{a.note}</p>}
                      </section>
                      {a.status === "pending" && (
                        <div className="approval-actions">
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() => {
                              const note = window.prompt(
                                "Note de décision (facultative) :",
                                "",
                              );
                              if (note !== null)
                                void onSave({
                                  action: "decide_approval",
                                  approval_id: a.id,
                                  decision: "approved",
                                  note,
                                });
                            }}
                          >
                            Approuver
                          </button>
                          <button
                            className="button outline"
                            disabled={busy}
                            onClick={() => {
                              const note = window.prompt(
                                "Motif du refus :",
                                "",
                              );
                              if (note !== null)
                                void onSave({
                                  action: "decide_approval",
                                  approval_id: a.id,
                                  decision: "rejected",
                                  note,
                                });
                            }}
                          >
                            Refuser
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="check" />
                <p>Aucun devis ne nécessite d’approbation pour le moment.</p>
              </div>
            )}
            <h3>Règles enregistrées</h3>
            {data.approval_rules.map((r) => (
              <div className="rule-row" key={r.site_id}>
                <Icon name="shield" />
                <span>
                  <strong>
                    {sites.find((s) => s.id === r.site_id)?.name || "Site"}
                  </strong>
                  <small>
                    Au-delà de {money(r.threshold_cents)} —{" "}
                    {r.required_role === "owner"
                      ? "propriétaire"
                      : "gestionnaire"}{" "}
                    — {r.enabled ? "active" : "désactivée"}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSite) return;
              void onSave({
                action: "set_approval_rule",
                site_id: selectedSite,
                threshold_cents: Math.round(Number(threshold) * 100),
                required_role: requiredRole,
                enabled,
              });
            }}
          >
            <h3>Configurer une approbation</h3>
            <p>
              Les nouveaux devis dépassant le seuil nécessiteront une décision
              avant acceptation.
            </p>
            {siteField()}
            <Field label="Seuil de validation TTC (€)">
              <input
                required
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
            <Field label="Responsable de validation">
              <select
                value={requiredRole}
                onChange={(e) => setRequiredRole(e.target.value)}
              >
                <option value="manager">Gestionnaire de l’organisation</option>
                <option value="owner">Propriétaire de l’organisation</option>
              </select>
            </Field>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Règle active
            </label>
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !selectedSite}
            >
              Enregistrer la règle
            </button>
          </form>
        </div>
      ) : tab === "contracts" ? (
        <div className="operations-grid">
          <div>
            <h3>Contrats de l’organisation</h3>
            {data.contracts.length ? (
              <div className="contract-list">
                {data.contracts.map((c) => (
                  <details key={c.id}>
                    <summary>
                      <span>
                        <strong>{c.title}</strong>
                        <small>
                          Réf. {c.reference} —{" "}
                          {c.status === "active"
                            ? "Actif"
                            : c.status === "archived"
                              ? "Archivé"
                              : "Brouillon"}
                        </small>
                      </span>
                      <Icon name="arrow" size={17} />
                    </summary>
                    <p>
                      Du {date(c.starts_on)}
                      {c.ends_on ? ` au ${date(c.ends_on)}` : ""}
                    </p>
                    <p>{c.terms}</p>
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() =>
                        void onSave({
                          action: "save_contract",
                          id: c.id,
                          organization_id: c.organization_id,
                          title: c.title,
                          reference: c.reference,
                          starts_on: c.starts_on,
                          ends_on: c.ends_on || undefined,
                          terms: c.terms,
                          status:
                            c.status === "archived" ? "active" : "archived",
                        })
                      }
                    >
                      {c.status === "archived" ? "Réactiver" : "Archiver"}
                    </button>
                  </details>
                ))}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="document" />
                <p>Aucun contrat cadre enregistré.</p>
              </div>
            )}
          </div>
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!organizations[0]?.id) return;
              void onSave({
                action: "save_contract",
                organization_id: organizations[0].id,
                title,
                reference,
                starts_on: starts,
                ends_on: ends || undefined,
                terms,
                status: contractStatus,
              });
            }}
          >
            <h3>Enregistrer un contrat cadre</h3>
            <p>
              Archivage d’un accord existant. Ce formulaire ne constitue pas une
              signature électronique.
            </p>
            <Field label="Intitulé">
              <input
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Référence">
              <input
                required
                minLength={2}
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <div className="form-columns">
              <Field label="Début">
                <input
                  required
                  type="date"
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
              </Field>
              <Field label="Fin (facultative)">
                <input
                  type="date"
                  min={starts || undefined}
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Conditions et grille tarifaire">
              <textarea
                required
                minLength={5}
                maxLength={8000}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Périmètre, prestations, conditions et tarifs convenus…"
              />
            </Field>
            <Field label="État du document">
              <select
                value={contractStatus}
                onChange={(e) => setContractStatus(e.target.value)}
              >
                <option value="draft">Brouillon</option>
                <option value="active">Actif</option>
                <option value="archived">Archivé</option>
              </select>
            </Field>
            {!organizations.length && (
              <p className="form-note">
                Ajoutez un premier site pour créer votre organisation.
              </p>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !organizations.length}
            >
              Enregistrer le contrat
            </button>
          </form>
        </div>
      ) : (
        <div className="operations-grid">
          <div>
            <h3>Échéances et signalements</h3>
            {data.compliance_records.length ? (
              <div className="compliance-list">
                {data.compliance_records.map((r) => (
                  <div key={r.id}>
                    <span className="record-icon">
                      <Icon
                        name={
                          r.kind === "safety"
                            ? "warning"
                            : r.kind === "audit"
                              ? "shield"
                              : "wrench"
                        }
                      />
                    </span>
                    <section>
                      <strong>{r.title}</strong>
                      <p>
                        {sites.find((s) => s.id === r.site_id)?.name || "Site"}{" "}
                        — {date(r.due_on)}
                      </p>
                      <span
                        className={`badge ${r.status === "completed" ? "status-paid" : "status-quoted"}`}
                      >
                        {r.status === "completed"
                          ? "Terminé"
                          : r.status === "scheduled"
                            ? "Planifié"
                            : "À traiter"}
                      </span>
                      {r.notes && <p>{r.notes}</p>}
                      {r.status !== "completed" && (
                        <button
                          className="button outline"
                          disabled={busy}
                          onClick={() =>
                            void onSave({
                              action: "save_compliance",
                              id: r.id,
                              site_id: r.site_id,
                              title: r.title,
                              kind: r.kind,
                              due_on: r.due_on,
                              status: "completed",
                              notes: r.notes,
                            })
                          }
                        >
                          Marquer terminé
                        </button>
                      )}
                    </section>
                  </div>
                ))}
              </div>
            ) : (
              <div className="operation-empty">
                <Icon name="calendar" />
                <p>Aucune échéance de maintenance ou d’audit enregistrée.</p>
              </div>
            )}
            <div className="inline-note">
              <Icon name="shield" />
              <p>
                Ces enregistrements organisent le suivi. Ils ne certifient pas
                la conformité d’une installation ou d’un ERP.
              </p>
            </div>
          </div>
          <form
            className="operations-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSite) return;
              void onSave({
                action: "save_compliance",
                site_id: selectedSite,
                title,
                kind,
                due_on: due,
                status: recordStatus,
                notes,
              });
            }}
          >
            <h3>Ajouter une échéance</h3>
            <p>
              Audit électrique, maintenance préventive ou signalement de
              sécurité.
            </p>
            {siteField()}
            <Field label="Intitulé">
              <input
                required
                minLength={2}
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Type de suivi">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="maintenance">Maintenance préventive</option>
                <option value="audit">Audit électrique</option>
                <option value="safety">Signalement de sécurité</option>
              </select>
            </Field>
            <Field label="Échéance">
              <input
                required
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </Field>
            <Field label="État">
              <select
                value={recordStatus}
                onChange={(e) => setRecordStatus(e.target.value)}
              >
                <option value="pending">À traiter</option>
                <option value="scheduled">Planifié</option>
                <option value="completed">Terminé</option>
              </select>
            </Field>
            <Field label="Notes et équipements concernés">
              <textarea
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Par exemple : armoire froide, circuit de cuisine, éclairage de sécurité…"
              />
            </Field>
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !selectedSite}
            >
              Enregistrer l’échéance
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

type WarrantyCase = {
  id: string;
  intervention_id: string;
  description: string;
  status: "submitted" | "reviewing" | "resolved" | "declined";
  resolution?: string;
  created_at: string;
};
function WarrantyPanel({
  interventionId,
  demo,
  role,
}: {
  interventionId?: string;
  demo: boolean;
  role: Role;
}) {
  const [cases, setCases] = useState<WarrantyCase[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setLoading(true);
    try {
      if (demo) {
        setCases(
          JSON.parse(localStorage.getItem("courant-warranty-demo-v1") || "[]"),
        );
        return;
      }
      const result = await api<{ cases: WarrantyCase[] }>("/api/warranty");
      setCases(result.cases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [demo, interventionId]);
  const visible = cases.filter(
    (c) => !interventionId || c.intervention_id === interventionId,
  );
  async function save(values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (demo) {
        const next =
          values.action === "request"
            ? [
                ...cases,
                {
                  id: uid(),
                  intervention_id: interventionId!,
                  description,
                  status: "submitted" as const,
                  created_at: new Date().toISOString(),
                },
              ]
            : cases.map((c) =>
                c.id === values.case_id
                  ? {
                      ...c,
                      status: values.status as WarrantyCase["status"],
                      resolution: String(values.resolution),
                    }
                  : c,
              );
        localStorage.setItem("courant-warranty-demo-v1", JSON.stringify(next));
        setCases(next);
        setNotice(
          "Suivi enregistré dans la démonstration. Aucune demande réelle n’est transmise.",
        );
      } else {
        await api("/api/warranty", values);
        await load();
        setNotice("Votre dossier a été enregistré.");
      }
      setDescription("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel warranty-panel">
      <div className="section-heading">
        <h2>Suivi après intervention</h2>
        <Icon name="shield" />
      </div>
      <p className="warranty-intro">
        Le projet prévoit une garantie d’un an. Le dépôt réel des demandes
        nécessite l’activation des conditions commerciales par l’exploitant.
        Aucun droit contractuel n’est attesté par cette démonstration.
      </p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <p className="document-empty">Chargement du suivi…</p>
      ) : visible.length ? (
        <div className="warranty-list">
          {visible.map((c) => (
            <div key={c.id}>
              <div>
                <span
                  className={`badge ${c.status === "resolved" ? "status-paid" : c.status === "declined" ? "status-cancelled" : "status-quoted"}`}
                >
                  {
                    {
                      submitted: "Demande enregistrée",
                      reviewing: "En cours d’examen",
                      resolved: "Résolue",
                      declined: "Refusée",
                    }[c.status]
                  }
                </span>
                <small>{date(c.created_at)}</small>
              </div>
              <p>{c.description}</p>
              {c.resolution && (
                <p>
                  <strong>Réponse : </strong>
                  {c.resolution}
                </p>
              )}
              {role === "admin" &&
                ["submitted", "reviewing"].includes(c.status) && (
                  <div className="warranty-actions">
                    {[
                      ["reviewing", "Examiner"],
                      ["resolved", "Résoudre"],
                      ["declined", "Refuser"],
                    ].map(([status, label]) => (
                      <button
                        className="button outline"
                        disabled={busy}
                        key={status}
                        onClick={() => {
                          const resolution = window.prompt(
                            "Note de traitement (au moins 10 caractères) :",
                            c.resolution || "",
                          );
                          if (resolution === null) return;
                          if (resolution.trim().length < 10) {
                            setError(
                              "La note de traitement doit contenir au moins 10 caractères.",
                            );
                            return;
                          }
                          void save({
                            action: "resolve",
                            case_id: c.id,
                            status,
                            resolution,
                          });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          ))}
        </div>
      ) : (
        <p className="document-empty">Aucune demande de suivi enregistrée.</p>
      )}
      {interventionId &&
        ["client", "manager"].includes(role) &&
        !visible.some((c) => ["submitted", "reviewing"].includes(c.status)) && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save({
                action: "request",
                intervention_id: interventionId,
                description,
              });
            }}
          >
            <Field
              label="Signaler un problème après intervention"
              hint="Décrivez le problème et son lien avec l’intervention terminée."
            >
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
            <button
              className="button outline full"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Enregistrement…"
                : demo
                  ? "Enregistrer un signalement de démonstration"
                  : "Déposer une demande de suivi"}
            </button>
          </form>
        )}
    </section>
  );
}
