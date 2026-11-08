import type { BookingDraft } from "./booking-draft";
// Contract between the session controller (components/courant-app.tsx) and the role spaces
// (components/role/*). Spaces are presentational: every mutation, demo counterpart and
// live/unavailable decision goes through this object so that identity resets and role
// guards are enforced in one place.
import type { FeatureClients, FeatureKey, ReprobeHint } from "./features";
import type { RefreshOutcome } from "./workspace-refresh";
import type { PlatformAccess } from "../../lib/features/platform-operations/types";
import type {
  AdminInterventionDetail,
  AdminInterventionsPage,
  AdminListFilters,
  AdminOverview,
  ArtisanCommand,
  ArtisanDossier,
  ArtisanPerformanceReport,
  Capabilities,
  Category,
  DirectoryFilters,
  DirectoryItem,
  DirectoryKind,
  DirectoryPage,
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
  QuoteDraftCommand,
  QuoteDraftEnvelope,
  QuoteDraftResult,
  RequestValues,
  ReturnContext,
  Role,
  SiteAccessCommand,
  SiteAccessOverview,
  SupportCommand,
  SupportCommandResult,
  SupportCreateResult,
  SupportDetail,
  SupportListFilters,
  SupportListPage,
  UploadQueue,
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
  /** Booking extras of the service flow (private contact included), same identity chain only. */
  booking: BookingDraft | null;
  go(view: View, param?: string): void;
  setAuthMode(mode: AuthMode): void;
  setCategory(category: Category): void;
  setError(message: string): void;
  setNotice(message: string): void;
  /** Opens the isolated demonstration with the given role, view and optional demo dossier id. */
  startDemo(role?: Role, view?: View, param?: string): void;
  /** Keeps an anonymous request draft and routes to account creation. */
  saveDraft(values: RequestValues): void;
  /** Invitation code waiting for a login (view join-organization/CODE). */
  pendingInvitation: string | null;
  /** Stores a manually shared organisation invitation code, then routes to login. */
  keepInvitation(token: string): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(values: { email: string; password: string; full_name: string; first_name?: string; last_name?: string; role: Role }): Promise<boolean>;
  resetPassword(email: string): Promise<boolean>;
}

export interface Session {
  mode: Exclude<Mode, "public">;
  role: Role;
  profile: Profile | null;
  /** Current user id: server profile id in live mode, demo-<role> in demo mode. */
  profileId: string;
  displayName: string;
  /** First name from the real profile (live) or the demo cast (demo); null when unknown — never invented. */
  firstName: string | null;
  /** Public request draft kept across login (same identity chain only); cleared after POST 201. */
  pendingDraft: RequestValues | null;
  /** Booking extras of the service flow (private contact included), same identity chain only. */
  booking: BookingDraft | null;
  /** Card-hold provider return awaiting a server verification (independent of the draft). */
  cardReturn: import("./card-return").CardReturn | null;
  /** GET /api/bookings/pending failed (an error is never « nothing pending »). */
  /** Identity guard for leaves that mutate outside run(ctx): compare before/after every await. */
  mutationContext: { generation(): number; userId(): string | null };
  pendingLookupFailed: boolean;
  retryPendingLookup(): void;
  /** Booking confirmation « Modifier »: replace the kept request draft / private contact (no send). */
  updatePendingDraft(values: RequestValues): void;
  updateBookingContact(contact: BookingDraft["contact"]): void;
  updateBookingPayment(payment: NonNullable<BookingDraft["payment"]>): void;
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
  /** Timestamp of the last successful workspace load; spaces re-read scoped views when it changes. */
  refreshedAt: number;

  go(view: View, param?: string): void;
  openIntervention(id: string, quoteId?: string): void;
  setNotice(message: string): void;
  setError(message: string): void;
  setActiveOrganization(id: string): void;
  setActiveSite(id: string): void;

  /** Wraps a task with busy/error handling. Resolves true when the task completed. */
  run(task: () => Promise<void>): Promise<boolean>;
  refresh(): Promise<void>;
  /** Workspace read with causal freshness (barrier by default); explicit outcome (WEB-DEEPLINK-REFRESH-001). */
  ensureFresh(options?: { barrier?: boolean }): Promise<RefreshOutcome>;
  /** Identity generation + role + active organisation + site: keys per-context memories. */
  refreshContext: string;
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
  /** Artisan dossier: own dossier, or another artisan's when the caller is a platform admin. */
  loadArtisanDossier(userId?: string): Promise<ArtisanDossier | null>;
  artisanCommand(body: ArtisanCommand): Promise<boolean>;
  /** New contract GET /api/admin/overview. */
  loadAdminOverview(): Promise<AdminOverview | null>;
  /** Admin dossier list, server-paginated (cursor) and filtered; null when unavailable. */
  loadAdminInterventions(params: AdminListFilters & { limit?: number; cursor?: string | null }): Promise<AdminInterventionsPage | null>;
  /** Admin directories (artisans / clients / organisations), keyset-paginated with exact totals; null when unavailable. */
  loadAdminDirectory<K extends DirectoryKind>(
    kind: K,
    params: DirectoryFilters & { limit?: number; cursor?: string | null },
  ): Promise<DirectoryPage<K> | null>;
  /** Minimal detail of one directory entry outside the loaded window; null when absent/unavailable. */
  loadAdminDirectoryItem<K extends DirectoryKind>(kind: K, id: string): Promise<DirectoryItem<K> | null>;
  /** Admin detail of any dossier (not limited to the 100 loaded in workspace), with bounded quotes. */
  loadAdminIntervention(id: string): Promise<AdminInterventionDetail | null>;
  /** Quote draft envelope of the assigned artisan (contract QUOTE-DRAFT-001); null when unavailable. */
  loadQuoteDraft(interventionId: string): Promise<QuoteDraftEnvelope | null>;
  /**
   * save / discard / send on the draft. A 409 is returned as a conflict (the caller keeps the
   * typed lines and offers a reload); a successful send returns the exact created quote_id.
   */
  quoteDraftCommand(interventionId: string, body: QuoteDraftCommand): Promise<QuoteDraftResult>;
  /** Assistance tickets (contract SUPPORT-001); null when unavailable. */
  loadSupportTickets(filters: SupportListFilters): Promise<SupportListPage | null>;
  loadSupportTicket(id: string, page?: { limit?: number; after_version?: number }): Promise<SupportDetail | null>;
  /**
   * Creates a ticket. `requestId` is an idempotency key the caller generates ONCE per form
   * submission and keeps until success, so a retry after an uncertain outcome never duplicates.
   */
  createSupportTicket(values: { request_id: string; subject: string; body: string; intervention_id: string | null }): Promise<SupportCreateResult | null>;
  /** Reply or (admin) status change with the exact expected version; 409 is returned as a conflict. */
  supportCommand(id: string, body: SupportCommand): Promise<SupportCommandResult>;
  /** Organisation membership read model (GET /api/organizations?organization_id=). */
  loadOrganization(organizationId: string): Promise<OrganizationOverview | null>;
  /** Owner-only member commands; create_invitation resolves with the one-time code. */
  organizationCommand(body: OrganizationCommand): Promise<InvitationCreated | boolean>;
  /** Accept a manually shared invitation code for the logged-in verified recipient. */
  acceptInvitation(token: string): Promise<boolean>;
  /** Site scopes of members (contract 009): own scope, all scopes for the owner. */
  loadSiteAccess(organizationId: string): Promise<SiteAccessOverview | null>;
  /** Owner-only: replace a member's site scope and grants atomically. */
  setSiteAccess(body: SiteAccessCommand): Promise<boolean>;
  /** Artisan global performance for the current and previous calendar month (browser timezone). */
  loadArtisanPerformance(): Promise<ArtisanPerformanceReport | null>;
  /** Server truth for a quote's payment (status + attempts); the return URL never decides. */
  loadPaymentStatus(quoteId: string): Promise<PaymentStatusReport | null>;

  /** Creates the dossier, then uploads the given photos one by one (live only). */
  createIntervention(values: RequestValues, photos?: File[]): Promise<boolean>;
  /** Signed-in client « Nouvelle demande »: keeps the request as a booking draft (payment choice on
   *  BookingConfirm, sent by confirmBooking). Sends nothing; false when not applicable/not stored. */
  startBooking(values: RequestValues, photos?: File[]): boolean;
  /** Photos kept in memory for the pending booking (never stored; lost on reload). */
  bookingPhotos(): File[];
  /** « Modifier » on a kept booking: replaces the in-memory photos (nothing sent). */
  updateBookingPhotos(photos: File[]): void;
  /** Service booking: POST /api/bookings (idempotent key), never the legacy route. */
  confirmBooking(): Promise<boolean>;
  /** Cancels the current card-hold attempt on the server (releases it); the draft stays. */
  cancelBooking(requestId?: string): Promise<boolean>;
  /** Card hold: server finalize for this key (never inferred from a return URL). */
  finalizeBooking(requestId: string): Promise<boolean>;
  /** Photo queues per dossier (pending, failed or uncertain items); never overwritten by a new request. */
  uploads: UploadQueue[];
  /**
   * Retries a dossier's queue: refused/pending files are re-sent; uncertain files are first
   * reconciled against the dossier's stored documents and re-sent only when `resendUncertain`.
   */
  retryUploads(interventionId: string, options?: { resendUncertain?: boolean }): Promise<boolean>;
  /** User confirms that an existing document (listed as candidate) is the uncertain photo. */
  acknowledgeUpload(interventionId: string, key: string, documentId: string): void;
  /** Drops a dossier's queue (files stay on the device; nothing is deleted on the server). */
  dismissUploads(interventionId: string): void;
  sendMessage(interventionId: string, body: string): Promise<boolean>;
  submitReview(interventionId: string, values: { rating: number; body: string }): Promise<boolean>;
  createSite(values: { name: string; type: string; address: string; budget_cents: number; organization_id?: string }): Promise<boolean>;
  updateProfile(values: { full_name: string; phone: string; first_name?: string; last_name?: string }): Promise<boolean>;
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

  /**
   * Advanced lots (WEB-SHARED-001): clients injected into the leaf components. Built once per
   * identity; in demonstration they operate on seeds only (`features.demo`).
   */
  features: FeatureClients;
  /** Server reply to the back-office probe (/me); the only truth for platform-* views. null = unknown. */
  platformAccess: PlatformAccess | null;
  /** Unread notifications from the server summary; null when unknown or unavailable. */
  unreadNotifications: number | null;
  /**
   * Bounded recovery after a transient failure: re-probes ONE contract under the current identity
   * and rights (the reply alone decides the new availability). Never grants anything; no-op in demo.
   */
  reprobeFeature(key: FeatureKey, hint?: ReprobeHint): Promise<void>;
}
