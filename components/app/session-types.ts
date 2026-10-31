// Contract between the session controller (components/courant-app.tsx) and the role spaces
// (components/role/*). Spaces are presentational: every mutation, demo counterpart and
// live/unavailable decision goes through this object so that identity resets and role
// guards are enforced in one place.
import type {
  AdminOverview,
  ArtisanCommand,
  ArtisanDossier,
  ArtisanPerformanceReport,
  Capabilities,
  Category,
  InterventionAction,
  InvitationCreated,
  Mode,
  OperationBody,
  Operations,
  OrganizationCommand,
  OrganizationOverview,
  PaymentStatusReport,
  ProfessionalData,
  Profile,
  RequestValues,
  ReturnContext,
  Role,
  View,
  Workspace,
} from "./types";

export type AuthMode = "login" | "signup" | "reset";
/** Unauthenticated shell (landing, help, legal pages, account entry, request draft). */
export interface PublicSession {
  view: View;
  param: string;
  busy: boolean;
  error: string;
  notice: string;
  authMode: AuthMode;
  categoryId: Category;
  pendingDraft: RequestValues | null;
  go(view: View, param?: string): void;
  setAuthMode(mode: AuthMode): void;
  setCategory(category: Category): void;
  setError(message: string): void;
  setNotice(message: string): void;
  /** Opens the isolated demonstration with the given role. */
  startDemo(role?: Role, view?: View): void;
  /** Keeps an anonymous request draft and routes to account creation. */
  saveDraft(values: RequestValues): void;
  /** Invitation code waiting for a login (view join-organization/CODE). */
  pendingInvitation: string | null;
  /** Stores a manually shared organisation invitation code, then routes to login. */
  keepInvitation(token: string): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(values: { email: string; password: string; full_name: string; role: Role }): Promise<boolean>;
  resetPassword(email: string): Promise<boolean>;
}

export interface Session {
  mode: Exclude<Mode, "public">;
  role: Role;
  profile: Profile | null;
  /** Current user id: server profile id in live mode, demo-<role> in demo mode. */
  profileId: string;
  displayName: string;
  data: Workspace;
  professional: ProfessionalData;
  capabilities: Capabilities;
  /** Parsed ?payment / ?connect / ?auth return, already re-read from the server. */
  returnContext: ReturnContext | null;
  view: View;
  /** Optional hash parameter (intervention id, site id, quote id…). */
  param: string;
  selectedId: string;
  selectedQuoteId: string;
  busy: boolean;
  loading: boolean;
  connection: string;
  error: string;
  notice: string;
  /** Enterprise context chosen explicitly by the user; empty = not chosen. */
  activeOrganizationId: string;
  activeSiteId: string;
  /** Authority in the active organisation from the membership table, never the global role. */
  membershipRole: "owner" | "manager" | "viewer" | null;

  go(view: View, param?: string): void;
  openIntervention(id: string, quoteId?: string): void;
  setNotice(message: string): void;
  setError(message: string): void;
  setActiveOrganization(id: string): void;
  setActiveSite(id: string): void;

  /** Wraps a task with busy/error handling. Resolves true when the task completed. */
  run(task: () => Promise<void>): Promise<boolean>;
  refresh(): Promise<void>;
  loadProfessional(): Promise<void>;

  /** Existing contract POST /api/interventions/[id]/actions. accept_quote must carry the displayed quote id (API-QUOTE-001). */
  action(
    id: string,
    name: InterventionAction | "simulate_payment",
    extra?: Record<string, unknown>,
  ): Promise<boolean>;
  /** New contract POST /api/interventions/[id]/operations, with explicit demo counterpart. */
  operate(id: string, body: OperationBody): Promise<boolean>;
  /** New contract GET /api/interventions/[id]/operations. null when unavailable (see capabilities). */
  loadOperations(id: string): Promise<Operations | null>;
  /** New contract /api/artisan. */
  loadArtisanDossier(): Promise<ArtisanDossier | null>;
  artisanCommand(body: ArtisanCommand): Promise<boolean>;
  /** New contract GET /api/admin/overview. */
  loadAdminOverview(): Promise<AdminOverview | null>;
  /** Organisation membership read model (GET /api/organizations?organization_id=). */
  loadOrganization(organizationId: string): Promise<OrganizationOverview | null>;
  /** Owner-only member commands; create_invitation resolves with the one-time code. */
  organizationCommand(body: OrganizationCommand): Promise<InvitationCreated | boolean>;
  /** Accept a manually shared invitation code for the logged-in verified recipient. */
  acceptInvitation(token: string): Promise<boolean>;
  /** Artisan global performance for the current and previous calendar month (browser timezone). */
  loadArtisanPerformance(): Promise<ArtisanPerformanceReport | null>;
  /** Server truth for a quote's payment (status + attempts); the return URL never decides. */
  loadPaymentStatus(quoteId: string): Promise<PaymentStatusReport | null>;

  createIntervention(values: RequestValues): Promise<boolean>;
  sendMessage(interventionId: string, body: string): Promise<boolean>;
  submitReview(interventionId: string, values: { rating: number; body: string }): Promise<boolean>;
  createSite(values: { name: string; type: string; address: string; budget_cents: number; organization_id?: string }): Promise<boolean>;
  updateProfile(values: { full_name: string; phone: string }): Promise<boolean>;
  /** Existing POST /api/professional actions (set_approval_rule, decide_approval, save_contract, save_compliance, set_site_budget). */
  professionalCommand(values: Record<string, unknown>): Promise<boolean>;
  checkout(quoteId: string): Promise<void>;
  connectStripe(): Promise<void>;
  logout(): Promise<void>;
  /** Demo only: switch the explored role; ignored in live mode. */
  setDemoRole(role: Role): void;
  resetDemo(): void;
  saveDemo(next: Workspace): void;
  setProfessional(next: ProfessionalData): void;
}
