import type { TaxRate } from "@/lib/tax-rates";
// Shared frontend types. Server contracts: app/api/* and docs/WEB_PWA_CONTRACTS.md (Codex branch).
import type { WorkspaceLimits } from "../../lib/features/workspace/detail-read";
export type Role = "client" | "artisan" | "manager" | "admin";
export type Mode = "public" | "demo" | "live";
export type Status =
  | "requested"
  | "assigned"
  | "quoted"
  | "accepted"
  | "in_progress"
  | "completed"
  | "paid"
  | "cancelled";
export type Category = "outage" | "panel" | "socket" | "lighting" | "diagnostic";
export type Urgency = "urgent" | "scheduled";
export type TravelStage = "planned" | "en_route" | "on_site";
export type InterventionAction =
  | "accept_mission"
  | "send_quote"
  | "accept_quote"
  | "start"
  | "complete"
  | "cancel";

export type Line = { label: string; quantity: number; unit_price_cents: number };
export type Intervention = {
  id: string;
  category: Category;
  description: string;
  address: string;
  postal_code: string;
  city: string;
  urgency: Urgency;
  status: Status;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
  paid_at?: string | null;
  estimate_min_cents: number;
  estimate_max_cents: number;
  artisan_id?: string | null;
  client_id?: string;
  site_id?: string | null;
  travel_stage?: TravelStage;
};
export type Quote = {
  id: string;
  intervention_id: string;
  artisan_id?: string;
  lines: Line[];
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  accepted_total_cents?: number;
  tax_rate: TaxRate;
  status: "sent" | "accepted" | "rejected" | string;
  created_at: string;
  accepted_at?: string | null;
};
export type Payment = {
  method?: "stripe" | "on_site_declared";
  id: string;
  quote_id: string;
  total_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | string;
  created_at: string;
  paid_at?: string | null;
};
export type Site = {
  id: string;
  organization_id?: string;
  name: string;
  type?: string;
  vertical?: string;
  address: string;
  budget_cents?: number;
  created_at?: string;
  archived_at?: string | null;
};
export type Organization = {
  id: string;
  name: string;
  type?: string;
  owner_id?: string;
};
export type OrganizationMember = {
  organization_id: string;
  user_id: string;
  role: "owner" | "manager" | "viewer" | string;
};
export type Message = {
  id: string;
  intervention_id: string;
  author_id: string;
  body: string;
  created_at: string;
  /** SYS-04 / M62: private photo (document id) of a photo message; null or absent for text. */
  attachment_id?: string | null;
};
export type Profile = {
  id: string;
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  role: Role;
  artisan_approved?: boolean;
  approved?: boolean;
  phone?: string;
  created_at?: string;
};
export type StoredDocument = {
  id: string;
  intervention_id?: string | null;
  owner_id?: string;
  name: string;
  mime_type: string;
  created_at: string;
};
export type Review = {
  id: string;
  intervention_id: string;
  author_id?: string;
  rating: number;
  body: string;
  created_at?: string;
};
export type ApprovalRule = {
  id?: string;
  site_id: string;
  threshold_cents: number;
  required_role: string;
  enabled: boolean;
};
export type Approval = {
  id: string;
  quote_id: string;
  site_id?: string;
  status: string;
  note?: string;
  decided_by?: string | null;
  created_at?: string;
  decided_at?: string | null;
};
export type Contract = {
  id: string;
  organization_id: string;
  title: string;
  reference: string;
  starts_on: string;
  ends_on?: string | null;
  terms: string;
  status: string;
};
export type ComplianceRecord = {
  id: string;
  site_id: string;
  title: string;
  kind: string;
  due_on: string;
  status: string;
  notes: string;
};
export type ProfessionalAudit = {
  id: number | string;
  organization_id: string;
  actor_id: string;
  subject_id: string;
  action: string;
  created_at: string;
};
export type ProfessionalData = {
  approval_rules: ApprovalRule[];
  approvals: Approval[];
  contracts: Contract[];
  compliance_records: ComplianceRecord[];
  audit?: ProfessionalAudit[];
};
export type ArtisanApplicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "suspended";
export type ArtisanProfile = {
  user_id: string;
  company_name: string;
  siret: string;
  legal_status: string;
  employee_count: number;
  address: string;
  postal_codes: string[];
  categories: Category[];
  available: boolean;
  application_status: ArtisanApplicationStatus;
  submitted_at?: string | null;
  updated_at?: string;
};
export type CredentialKind = "registration" | "liability" | "qualification" | "other";
export type ArtisanCredential = {
  id: string;
  user_id: string;
  document_id: string;
  kind: CredentialKind;
  expires_on?: string | null;
  created_at: string;
};
export type ArtisanDossier = {
  artisan_profile: ArtisanProfile | null;
  credentials: ArtisanCredential[];
};
export type Participant = {
  id: string;
  full_name: string;
  phone: string;
  role: Role | string;
};
export type Appointment = {
  intervention_id: string;
  starts_at: string;
  ends_at: string;
  note: string;
  updated_by?: string;
  updated_at?: string;
};
export type ReportCheck = {
  label: string;
  result: "pass" | "issue" | "not_applicable";
};
export type InterventionReport = {
  intervention_id: string;
  artisan_id?: string;
  summary: string;
  checks: ReportCheck[];
  signature_name: string;
  updated_at?: string;
};
export type OperationEvent = {
  id: number | string;
  intervention_id: string;
  actor_id: string;
  kind: "appointment" | "report";
  payload: Record<string, unknown>;
  created_at: string;
};
export type Operations = {
  participants: Participant[];
  appointment: Appointment | null;
  report: InterventionReport | null;
  history: OperationEvent[];
  history_limit: number;
  travel_stage: TravelStage;
};
export type OperationBody =
  | { action: "decline_offer"; reason: string }
  | { action: "reject_quote"; quote_id: string; reason: string }
  | { action: "save_appointment"; starts_at: string; ends_at: string; note: string }
  | { action: "set_travel_stage"; stage: TravelStage }
  | {
      action: "save_report";
      summary: string;
      checks: ReportCheck[];
      signature_name: string;
    }
  | { action: "reassign"; artisan_id: string | null; reason: string };
export type ArtisanCommand =
  | {
      action: "save_profile";
      company_name: string;
      siret: string;
      legal_status: string;
      employee_count: number;
      address: string;
      postal_codes: string[];
      categories: Category[];
    }
  | { action: "submit_application" }
  | { action: "set_availability"; available: boolean }
  | {
      action: "link_credential";
      document_id: string;
      kind: CredentialKind;
      expires_on: string | null;
    };
export type AdminOverview = {
  counts: {
    interventions: number;
    active_interventions: number;
    artisans: number;
    pending_applications: number;
    clients: number;
    organizations: number;
  };
  financial: {
    paid_service_cents: number;
    bank_paid_service_cents?: number;
    on_site_declared_cents?: number;
    currency: string;
    platform_revenue_cents: number | null;
    note: string;
  };
  artisans: (Profile & {
    company_name?: string | null;
    application_status?: ArtisanApplicationStatus | null;
  })[];
  clients: Profile[];
  organizations: Organization[];
  interventions: Intervention[];
  audit: {
    id: number | string;
    actor_id: string | null;
    intervention_id: string | null;
    action: string;
    created_at: string;
  }[];
  capabilities: {
    dispatch_before_quote_acceptance: boolean;
    refunds: boolean;
    invoices: boolean;
    support_tickets: boolean;
    list_limit: number;
  };
};
export type OrganizationInvitation = {
  id: string;
  organization_id?: string;
  email: string;
  role: "manager" | "viewer" | string;
  status: "pending" | "accepted" | "revoked" | "expired" | string;
  created_at: string;
  expires_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  site_scope?: "all" | "selected";
  site_grants?: { site_id: string; can_write: boolean }[];
};
export type MembershipEvent = {
  id: number | string;
  actor_id: string;
  action: string;
  target_user_id?: string | null;
  invitation_id?: string | null;
  previous_role?: string | null;
  next_role?: string | null;
  created_at: string;
};
export type OrganizationOverview = {
  organization: Organization & { created_at?: string };
  current_role: "owner" | "manager" | "viewer" | "platform_admin" | null;
  members: { user_id: string; role: string; full_name: string }[];
  invitations: OrganizationInvitation[];
  events: MembershipEvent[];
  limits: {
    members: number;
    invitations: number;
    events: number;
    members_limited: boolean;
    invitations_limited: boolean;
    events_limited: boolean;
  };
  permissions: {
    can_manage: boolean;
    site_scoped_roles: boolean;
    automated_invitation_email: boolean;
  };
};
export type SiteGrant = { site_id: string; can_write: boolean };
export type SiteScope = "all" | "selected";
export type MemberSiteAccess = {
  user_id: string;
  scope: SiteScope;
  grants: SiteGrant[];
  full_name?: string;
  role?: string;
};
// Shape of organization_site_access_overview (migration 009): members contains only the
// caller's own row unless the caller is the owner or a platform admin.
export type SiteAccessOverview = {
  organization_id: string;
  can_manage: boolean;
  members: MemberSiteAccess[];
};
export type SiteAccessCommand = {
  organization_id: string;
  user_id: string;
  scope: SiteScope;
  grants: SiteGrant[];
};
export type OrganizationCommand =
  | {
      action: "create_invitation";
      organization_id: string;
      email: string;
      role: "manager" | "viewer";
      expires_in_days: number;
      site_scope?: SiteScope;
      site_grants?: SiteGrant[];
    }
  | { action: "revoke_invitation"; organization_id: string; invitation_id: string }
  | { action: "change_member_role"; organization_id: string; user_id: string; role: "manager" | "viewer" }
  | { action: "remove_member"; organization_id: string; user_id: string }
  | { action: "transfer_ownership"; organization_id: string; user_id: string };
export type InvitationCreated = {
  invitation: OrganizationInvitation;
  invitation_code: string;
  invite_url: string;
  delivery: "manual_share";
};
export type PaymentAttempt = {
  method?: "stripe" | "on_site_declared";
  id?: string;
  quote_id?: string;
  status: "pending" | "paid" | "failed" | "expired" | string;
  total_cents: number;
  currency: string;
  failure_code?: string | null;
  created_at: string;
  updated_at?: string;
  paid_at?: string | null;
};
export type PaymentStatusReport = {
  payment: PaymentAttempt | null;
  attempts: PaymentAttempt[];
  attempts_limit: number;
  history_limited: boolean;
};
export type ArtisanPerformanceReport = {
  period: {
    current_start: string;
    current_end: string;
    previous_start: string;
    previous_end: string;
    boundary: string;
  };
  current: { paid_service_cents: number; paid_count: number; completed_missions_count: number };
  previous: { paid_service_cents: number; paid_count: number; completed_missions_count: number };
  rating: { average: number | null; count: number; period: string };
  growth_percent: number | null;
  punctuality_rate: null;
  currency: string;
  scope: string;
  limited: boolean;
  basis: Record<string, string>;
};
export type Workspace = {
  limits?: WorkspaceLimits;
  client_counts?: import("../../lib/features/client-interventions/contract").ClientWorkspaceCounters;
  documents: StoredDocument[];
  reviews: Review[];
  profile: Profile | null;
  interventions: Intervention[];
  quotes: Quote[];
  sites: Site[];
  organizations: Organization[];
  messages: Message[];
  payments: Payment[];
  organization_members: OrganizationMember[];
  artisan_profile: ArtisanProfile | null;
  appointments: Appointment[];
  appointments_limit?: number;
  appointments_limited?: boolean;
};
export const EMPTY_WORKSPACE: Workspace = {
  documents: [],
  reviews: [],
  profile: null,
  interventions: [],
  quotes: [],
  sites: [],
  organizations: [],
  messages: [],
  payments: [],
  organization_members: [],
  artisan_profile: null,
  appointments: [],
};
export const EMPTY_PROFESSIONAL: ProfessionalData = {
  approval_rules: [],
  approvals: [],
  contracts: [],
  compliance_records: [],
  audit: [],
};
export type WarrantyCase = {
  id: string;
  intervention_id: string;
  description: string;
  status: "submitted" | "reviewing" | "resolved" | "declined";
  resolution?: string;
  created_at: string;
  /** PUB-06: terms publication in force when the case was filed (null on historical cases). */
  terms_version?: number | null;
};
export type RequestValues = {
  category: Category;
  description: string;
  address: string;
  postal_code: string;
  city: string;
  urgency: Urgency;
  site_id?: string;
};

// Availability of a backend contract as observed by the browser, never assumed.
export type ContractState = "unknown" | "available" | "missing" | "unavailable";
export type Capabilities = {
  operations: ContractState;
  artisan: ContractState;
  adminOverview: ContractState;
  professional: ContractState;
  organizations: ContractState;
  performance: ContractState;
  payments: ContractState;
  siteAccess: ContractState;
  adminLists: ContractState;
  quoteDraft: ContractState;
  adminDirectory: ContractState;
  support: ContractState;
  // Advanced lots (WEB-SHARED-001): probed independently, never assumed deployed.
  quoteDocuments: ContractState;
  planning: ContractState;
  notifications: ContractState;
  siteOperations: ContractState;
  platformOperations: ContractState;
  tracking: ContractState;
};
export const UNKNOWN_CAPABILITIES: Capabilities = {
  operations: "unknown",
  artisan: "unknown",
  adminOverview: "unknown",
  professional: "unknown",
  organizations: "unknown",
  performance: "unknown",
  payments: "unknown",
  siteAccess: "unknown",
  adminLists: "unknown",
  quoteDraft: "unknown",
  adminDirectory: "unknown",
  support: "unknown",
  quoteDocuments: "unknown",
  planning: "unknown",
  notifications: "unknown",
  siteOperations: "unknown",
  platformOperations: "unknown",
  tracking: "unknown",
};
export type ReturnContext =
  | { kind: "payment"; state: "pending" | "cancelled"; interventionId: string }
  | { kind: "connect"; state: "returned" | "refresh" }
  | { kind: "auth"; state: "confirmed" | "expired" }
  /** Card hold provider return: a HINT only — the server finalize/status decides. */
  | { kind: "booking"; state: "success" | "cancel"; requestId: string };

// Every view the single-page shell can render. Access is decided in session.ts.
export type View =
  | "home"
  | "help"
  | "about"
  | "privacy"
  | "legal"
  | "pricing"
  | "join"
  | "join-organization"
  | "demo"
  | "auth"
  | "forbidden"
  | "overview"
  | "requests"
  | "new"
  | "detail"
  | "quote"
  | "missions"
  | "mission"
  | "quotes"
  | "messages"
  | "documents"
  | "sites"
  | "site"
  | "approvals"
  | "approval"
  | "contracts"
  | "reports"
  | "members"
  | "invoices"
  | "profile"
  | "support"
  | "application"
  | "performance"
  | "admin"
  | "admin-artisans"
  | "admin-artisan"
  | "admin-interventions"
  | "admin-quotes"
  | "admin-clients"
  | "admin-reviews"
  | "admin-messages"
  | "admin-settings"
  | "admin-warranty"
  // Advanced lots (WEB-SHARED-001) — reserved views, wired behind capability detection.
  | "quote-documents"
  | "planning"
  | "notifications"
  | "site-operations"
  | "platform-operators"
  | "platform-finance"
  | "platform-moderation"
  // A5: global assistance queue for scoped support operators (server capability `support`).
  | "support-queue";

// Photos selected with a request are uploaded one by one AFTER the dossier exists; failures
// stay in the queue for an explicit retry that never recreates the dossier.
// "uncertain": the connection dropped or the reply was unusable after the request left; the
// file may be stored. It is re-sent only after an explicit verification/confirmation.
export type UploadItem = {
  key: string;
  file: File;
  status: "pending" | "uploading" | "done" | "failed" | "uncertain";
  error?: string;
  documentId?: string;
  /** Same-name documents of the dossier, shown to the USER for verification; never auto-confirmed. */
  candidates?: { id: string; name: string; created_at: string }[];
};
export type UploadQueue = {
  interventionId: string;
  startedAt: string;
  items: UploadItem[];
};

// Contract WEB-PWA-ADMIN-LISTS-001 (published before implementation).
export type AdminListFilters = {
  status?: Status;
  category?: Category;
  urgency?: Urgency;
  site_id?: string;
  artisan_id?: string;
  client_id?: string;
  created_from?: string;
  created_to?: string;
  q?: string;
};
export type AdminInterventionRow = {
  id: string;
  client_id: string;
  artisan_id: string | null;
  site_id: string | null;
  category: Category;
  city: string;
  postal_code: string;
  urgency: Urgency;
  status: Status;
  created_at: string;
  updated_at: string;
};
export type AdminInterventionsPage = {
  interventions: AdminInterventionRow[];
  page: { limit: number; has_more: boolean; next_cursor: string | null; total: number };
  filters: AdminListFilters;
};
export type AdminInterventionDetail = {
  intervention: Intervention;
  quotes: Quote[];
  quotes_limit: number;
  quotes_limited: boolean;
};

// Contract WEB-PWA-QUOTE-DRAFT-001 (published before implementation): private persistent quote
// draft of the assigned artisan, optimistic version and assignment token. Saving is never sending.
export type QuoteDraft = {
  intervention_id: string;
  artisan_id: string;
  version: number;
  assignment_token: string;
  base_quote_id: string | null;
  lines: Line[];
  tax_rate: TaxRate | null;
  updated_at: string;
};
export type QuoteDraftEnvelope = {
  draft: QuoteDraft | null;
  version: number;
  assignment_token: string;
  current_quote_id: string | null;
  /** Present only in the answer of a successful send. */
  quote_id?: string;
  intervention?: Intervention;
};
export type QuoteDraftCommand =
  | {
      action: "save";
      expected_version: number;
      assignment_token: string;
      base_quote_id: string | null;
      lines: Line[];
      tax_rate: TaxRate | null;
    }
  | { action: "discard"; expected_version: number; assignment_token: string }
  | { action: "send"; expected_version: number; assignment_token: string };
export type QuoteDraftResult =
  | { ok: true; envelope: QuoteDraftEnvelope }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict: false; message: string };

// Contract WEB-PWA-ADMIN-DIRECTORIES-001: keyset-paginated admin directories with exact totals.
export type DirectoryKind = "artisans" | "clients" | "organizations";
export type DirectoryArtisan = {
  id: string;
  full_name: string;
  phone: string;
  artisan_approved: boolean;
  created_at: string;
  company_name: string | null;
  application_status: ArtisanApplicationStatus | null;
};
export type DirectoryClient = { id: string; full_name: string; phone: string; role: "client" | "manager"; created_at: string };
export type DirectoryOrganization = { id: string; name: string; owner_id: string; created_at: string };
export type DirectoryItem<K extends DirectoryKind> = K extends "artisans"
  ? DirectoryArtisan
  : K extends "clients"
    ? DirectoryClient
    : DirectoryOrganization;
export type DirectoryFilters = {
  q?: string;
  approved?: boolean;
  role?: "client" | "manager";
  owner_id?: string;
};
export type DirectoryPage<K extends DirectoryKind = DirectoryKind> = {
  kind: K;
  items: DirectoryItem<K>[];
  page: { limit: number; has_more: boolean; next_cursor: string | null; total: number };
  filters: { q: string | null; approved: boolean | null; role: string | null; owner_id: string | null };
};

// Contract WEB-PWA-SUPPORT-001 (published before implementation): private persistent assistance
// tickets. No phone, email, SMS, push or SLA is promised; replies are read by refreshing.
export type SupportStatus = "open" | "in_progress" | "awaiting_user" | "resolved";
export type SupportTicket = {
  id: string;
  creator_id: string;
  intervention_id: string | null;
  subject: string;
  status: SupportStatus;
  version: number;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};
export type SupportMessage = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_kind: "user" | "admin" | "operator";
  version: number;
  body: string;
  created_at: string;
};
export type SupportEvent = {
  id: string;
  ticket_id: string;
  actor_id: string;
  kind: "ticket_created" | "replied" | "status_changed";
  from_status: SupportStatus | null;
  to_status: SupportStatus;
  version: number;
  message_id: string | null;
  created_at: string;
};
export type SupportListFilters = {
  scope?: "mine" | "all";
  status?: SupportStatus;
  intervention_id?: string;
  q?: string;
  limit?: number;
  cursor?: string | null;
};
export type SupportListPage = {
  tickets: SupportTicket[];
  page: { limit: number; total: number; has_more: boolean; next_cursor: string | null };
  filters: { scope: string; status: string | null; intervention_id: string | null; q: string | null };
};
export type SupportDetail = {
  ticket: SupportTicket;
  messages: SupportMessage[];
  events: SupportEvent[];
  permissions: { can_reply: boolean; can_set_status: boolean };
  page: {
    limit: number;
    after_version: number;
    next_after_version: number | null;
    has_more: boolean;
    total_events: number;
    total_messages: number;
  };
};
export type SupportCreateResult = { ticket: SupportTicket; initial_message: SupportMessage; replayed: boolean };
export type SupportCommand =
  | { action: "reply"; expected_version: number; body: string }
  | { action: "set_status"; expected_version: number; status: SupportStatus };
export type SupportCommandResult =
  | { ok: true; ticket: SupportTicket; message: SupportMessage | null; event: SupportEvent }
  | { ok: false; conflict: boolean; message: string };
