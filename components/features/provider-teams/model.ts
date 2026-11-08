// ART-12 provider teams — pure model (no React). Contract: lib/features/provider-teams/contract.ts
// (copied exactly from aade14a; docs/PROVIDER_TEAMS_BACKEND.md):
//   GET  /api/provider-teams?after=                  → { records: Team[], next_after }
//   POST /api/provider-teams                         { action:"create", team_id, command_id, name }
//   GET  /api/provider-teams/:id?section=members|invitations|missions&after= → { team, section, records, next_after }
//   POST /api/provider-teams/:id                     rename | invite | revoke_invitation | set_role |
//                                                    remove_member | assign | unassign | progress
//   GET  /api/provider-teams/:id/missions/:job       → { team_id, intervention, appointment, assignment, permissions }
//   GET  /api/provider-team-invitations?after=       → { records: Invitation[], next_after }
//   POST /api/provider-team-invitations              { action: accept_invitation | decline_invitation, team_id, invitation_id, command_id }
//   Every write → receipt { team_id, action, team_version, entity_id, entity_version, state, replayed }.
// Rights are the server's: the UI only hides actions for the role / permissions the server returns.
// Identity fence on every write: the command is written to tab storage and read back BEFORE the POST
// (else 0 POST), keyed by uid + generation + scope, restored only by strict contract parse for the
// same identity (never sent automatically), never replayed after an identity change; 401/403 clear.
import { z } from "zod";
import { createCommand, invitation, invitationCommand, mission, receipt, sections, team, teamCommand } from "../../../lib/features/provider-teams/contract";

export const PT_TIMEOUT_MS = 15_000;
export const PT_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
export type Team = z.infer<typeof team>;
export type Member = z.infer<typeof sections.members>;
export type TeamInvitation = z.infer<typeof sections.invitations>;
export type TeamMission = z.infer<typeof sections.missions>;
export type MyInvitation = z.infer<typeof invitation>;
export type Mission = z.infer<typeof mission>;
export type Receipt = z.infer<typeof receipt>;
export type CreateCommand = z.infer<typeof createCommand>;
export type TeamCommand = z.infer<typeof teamCommand>;
export type InvitationCommand = z.infer<typeof invitationCommand>;
export type Section = keyof typeof sections;
export type AnyCommand = { kind: "create"; body: CreateCommand } | { kind: "team"; teamId: string; body: TeamCommand } | { kind: "invitation"; body: InvitationCommand };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lower = (v: string) => v.toLowerCase();
export const ptUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

/** Page invariants as the route checks them: ascending ids after `after`, next_after = last id of a full page. */
function pageOf<T extends z.ZodType>(schema: T, value: unknown, after: string | null): { records: z.infer<T>[]; next_after: string | null } | null {
  const r = z.object({ records: z.array(schema).max(50), next_after: z.string().regex(UUID).nullable() }).strict().safeParse(value);
  if (!r.success) return null;
  const records = r.data.records as Array<{ id: string }>;
  const a = after ? lower(after) : null;
  if (records.some((x, i) => (a && lower(x.id) <= a) || (i > 0 && lower(x.id) <= lower(records[i - 1].id)))) return null;
  if (r.data.next_after !== null && (records.length !== 50 || lower(r.data.next_after) !== lower(records[records.length - 1].id))) return null;
  return r.data as { records: z.infer<T>[]; next_after: string | null };
}
export const parseTeams = (v: unknown, after: string | null) => pageOf(team, v, after);
export const parseMyInvitations = (v: unknown, after: string | null) => pageOf(invitation, v, after);
export function parseTeamPage<S extends Section>(v: unknown, teamId: string, section: S, after: string | null): { team: Team; section: S; records: z.infer<(typeof sections)[S]>[]; next_after: string | null } | null {
  const base = z.object({ team, section: z.literal(section), records: z.array(z.unknown()), next_after: z.string().regex(UUID).nullable() }).strict().safeParse(v);
  if (!base.success || lower(base.data.team.id) !== lower(teamId)) return null;
  const p = pageOf(sections[section], { records: base.data.records, next_after: base.data.next_after }, after);
  return p ? { team: base.data.team, section, records: p.records as z.infer<(typeof sections)[S]>[], next_after: p.next_after } : null;
}
export function parseMission(v: unknown, teamId: string, jobId: string): Mission | null {
  const r = mission.safeParse(v);
  return r.success && lower(r.data.team_id) === lower(teamId) && lower(r.data.intervention.id) === lower(jobId) ? r.data : null;
}
const EXPECTED_STATE: Record<string, (c: Record<string, unknown>) => string | null> = {
  create: () => "created", rename: () => "renamed", invite: () => "pending", revoke_invitation: () => "revoked", remove_member: () => "inactive",
  set_role: (c) => String(c.role), accept_invitation: () => "accepted", decline_invitation: () => "declined", assign: () => "assigned", unassign: () => "unassigned", progress: (c) => String(c.state),
};
/** Receipt of exactly this command (same checks as the route). */
export function parseReceipt(v: unknown, cmd: AnyCommand): Receipt | null {
  const r = receipt.safeParse(v);
  if (!r.success) return null;
  const d = r.data, c = cmd.body as Record<string, unknown>;
  const teamId = cmd.kind === "team" ? cmd.teamId : String(c.team_id);
  const entity = "invitation_id" in c ? c.invitation_id : "user_id" in c ? c.user_id : "intervention_id" in c ? c.intervention_id : teamId;
  if (lower(d.team_id) !== lower(teamId) || d.action !== c.action || lower(d.entity_id) !== lower(String(entity)) || d.state !== EXPECTED_STATE[String(c.action)]?.(c)) return null;
  if ("expected_version" in c && c.expected_version !== null) {
    const ev = Number(c.expected_version);
    if (["assign", "unassign", "progress"].includes(String(c.action)) ? d.entity_version !== ev + 1 : d.team_version !== ev + 1) return null;
  }
  return d;
}

// ---- API ------------------------------------------------------------------------------------------
async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: PT_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? PT_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
const q = (after: string | null) => (after ? `after=${encodeURIComponent(after)}` : "");
export type PtApi = {
  teams(after: string | null): Promise<Result>;
  team(id: string, section: Section, after: string | null): Promise<Result>;
  mission(teamId: string, jobId: string): Promise<Result>;
  invitations(after: string | null): Promise<Result>;
  send(cmd: AnyCommand): Promise<Result>;
};
export function createPtApi(fetcher: typeof fetch = (...a) => fetch(...a), timeoutMs = PT_TIMEOUT_MS): PtApi {
  const get = (url: string) => timed(fetcher, url, { method: "GET" }, timeoutMs);
  const post = (url: string, body: unknown) => timed(fetcher, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  return {
    teams: (after) => get(`/api/provider-teams${after ? `?${q(after)}` : ""}`),
    team: (id, section, after) => get(`/api/provider-teams/${encodeURIComponent(id)}?section=${section}${after ? `&${q(after)}` : ""}`),
    mission: (teamId, jobId) => get(`/api/provider-teams/${encodeURIComponent(teamId)}/missions/${encodeURIComponent(jobId)}`),
    invitations: (after) => get(`/api/provider-team-invitations${after ? `?${q(after)}` : ""}`),
    send: (cmd) => (cmd.kind === "create" ? post("/api/provider-teams", cmd.body) : cmd.kind === "invitation" ? post("/api/provider-team-invitations", cmd.body) : post(`/api/provider-teams/${encodeURIComponent(cmd.teamId)}`, cmd.body)),
  };
}

// ---- Identity-fenced command runner ----------------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_KEY = "provider-teams-pending";
export const pendingKey = (uid: string | null, gen: number, scope: string) => `${PENDING_KEY}:${uid ?? "-"}:${gen}:${scope}`;
export const scopeOf = (cmd: AnyCommand) => (cmd.kind === "team" ? `team:${lower(cmd.teamId)}` : cmd.kind);
const storedSchema = z
  .object({
    uid: z.string().min(1),
    gen: z.number().int().nonnegative(),
    scope: z.string().min(1).max(60),
    command: z.union([
      z.object({ kind: z.literal("create"), body: createCommand }).strict(),
      z.object({ kind: z.literal("team"), teamId: z.string().regex(UUID), body: teamCommand }).strict(),
      z.object({ kind: z.literal("invitation"), body: invitationCommand }).strict(),
    ]),
  })
  .strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const COPY = {
  title: "Équipe prestataire",
  loading: "Lecture de votre équipe…",
  loadFailed: "Les données de l’équipe n’ont pas pu être lues. Réessayez.",
  forbidden: "Accès refusé par le serveur : votre rôle ou votre compte ne permet pas cette action ou cette lecture.",
  demo: "En démonstration, aucune équipe n’est lue ni modifiée et aucune invitation n’est envoyée.",
  noTeam: "Vous n’êtes membre d’aucune équipe.",
  invitationsTitle: "Invitations reçues",
  noInvitations: "Aucune invitation en attente pour l’adresse e-mail confirmée de votre compte.",
  invitationNote: "Une invitation n’est visible que par le compte dont l’e-mail confirmé correspond. Aucun e-mail ni SMS n’est envoyé.",
  roleNote: "Les rôles d’équipe (propriétaire, coordinateur, technicien) ne changent pas votre rôle sur la plateforme.",
  technicianNote: "En tant que technicien, vous suivez uniquement vos interventions affectées : ni prix, ni paiement, ni documents.",
  assignNote: "L’affectation interne concerne uniquement un dossier déjà attribué à l’artisan titulaire ; elle ne change ni le devis ni le paiement.",
  doneNote: "« Terminé » clôt votre suivi interne ; il ne termine pas le dossier commercial.",
  expiresNote: "Date d’expiration choisie explicitement, dans le futur ; aucune durée n’est imposée.",
  conflict: "Les données de l’équipe ont changé entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse cette commande : vérifiez la saisie.",
  notFound: "Cet élément n’est plus accessible.",
  limited: "Trop de commandes en peu de temps : réessayez dans un instant.",
  retry: "La commande n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  resumeNote: "Une commande de cet onglet attend sa confirmation : reprenez-la (même commande) avant toute autre action.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune commande n’est possible ici.",
  teamChecking: "Commande refusée : vérification de votre accès à l’équipe. Rien n’est affiché d’ici là.",
  targetGone: "Cet élément n’est plus accessible ; la commande n’a pas été appliquée. Les données de l’équipe ont été relues.",
  teamLost: "Accès à l’équipe retiré ou inaccessible : aucune donnée ni action de cette équipe n’est affichée.",
  more: "Afficher plus",
  moreFailed: "La page suivante n’a pas pu être lue. Ce qui est déjà affiché reste valable.",
  moreMembers: "Charger les autres membres",
  moreMembersNote: "Le choix ne liste que les membres déjà chargés.",
} as const;
export const ROLE_LABEL = { owner: "Propriétaire", coordinator: "Coordinateur", technician: "Technicien" } as const;
export const ASSIGNMENT_LABEL = { assigned: "Affecté", acknowledged: "Pris en compte", done: "Suivi terminé", unassigned: "Non affecté" } as const;
export const INVITATION_LABEL = { pending: "En attente", accepted: "Acceptée", declined: "Refusée", revoked: "Révoquée" } as const;
export const ACTION_NOTICE: Record<string, string> = {
  create: "Équipe créée.", rename: "Équipe renommée.", invite: "Invitation enregistrée (visible dans l’espace de la personne invitée).", revoke_invitation: "Invitation révoquée.",
  set_role: "Rôle modifié.", remove_member: "Membre retiré.", accept_invitation: "Invitation acceptée.", decline_invitation: "Invitation refusée.",
  assign: "Technicien affecté.", unassign: "Affectation retirée.", progress: "Suivi mis à jour.",
};
export type Outcome = "ok" | "pending" | "conflict" | "refused" | "forbidden" | "storage" | "ignored";
export type RunnerState = { busy: boolean; pending: AnyCommand | null; error: string; notice: string };
export const RUNNER_INITIAL: RunnerState = { busy: false, pending: null, error: "", notice: "" };

/** One runner per scope (a team, team creation, invitations). `after` re-reads on ok / conflict. */
/** `onNotFound` (team scope): a 404 on a write (write_provider_team raises P0002 for a removed
 *  member, or the target intervention is gone) closes the scope fail-closed — no notice, no replay. */
export function createRunner({ api, store, context, scope, get, set, after, onForbidden, onNotFound }: { api: () => PtApi; store: () => Store | null; context: Context; scope: string; get: () => RunnerState; set: (s: RunnerState) => void; after: () => Promise<void>; onForbidden: () => void; onNotFound?: () => void }) {
  let alive = true;
  let inFlight = false;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => alive && context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen, scope)));
  const persist = (cmd: AnyCommand, who: { uid: string | null; gen: number }) => {
    if (!who.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen, scope);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, scope, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: AnyCommand): Promise<Outcome> => {
    if (inFlight) return "ignored";
    const who = identity();
    if (!same(who) || scopeOf(cmd) !== scope || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return "storage";
    }
    inFlight = true;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().send(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return "ignored"; // another identity: never applied, never replayed
    if (r.status === 401 || r.status === 403) {
      clearStored(who);
      pendingFor = null;
      set({ ...RUNNER_INITIAL });
      onForbidden();
      return "forbidden";
    }
    if (r.status === 200) {
      const ok = parseReceipt(r.body, cmd);
      if (ok) {
        clearStored(who);
        pendingFor = null;
        set({ ...get(), busy: false, pending: null, notice: ACTION_NOTICE[String(cmd.body.action)] ?? "" });
        await after();
        return "ok";
      }
    }
    if (r.status === 404 && onNotFound) {
      clearStored(who);
      pendingFor = null;
      set({ ...RUNNER_INITIAL });
      onNotFound();
      return "forbidden";
    }
    if (r.status === 409) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: COPY.conflict });
      await after(); // re-read only, never a replay
      return "conflict";
    }
    if (r.status === 400 || r.status === 404 || r.status === 422 || r.status === 429) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 404 ? COPY.notFound : r.status === 429 ? COPY.limited : COPY.invalid });
      return "refused";
    }
    // Lost reply, timeout, 503, unverifiable 200: the SAME command on an explicit retry.
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return "pending";
  };
  return {
    /** A fresh command: refused while another one waits for its confirmation. */
    run(cmd: AnyCommand): Promise<Outcome> {
      if (get().pending || get().busy) return Promise.resolve("ignored");
      return send(cmd);
    },
    retry(): Promise<Outcome> {
      const p = get().pending;
      if (!p) return Promise.resolve("ignored");
      const who = identity();
      if (pendingFor !== `${who.uid}|${who.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve("ignored");
      }
      return send(p);
    },
    /** Offered for the same identity only (strict contract parse), never sent by itself. */
    restore() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, scope);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedSchema> | null = null;
      let original: AnyCommand | null = null;
      try {
        const json = JSON.parse(raw);
        const r = storedSchema.safeParse(json);
        parsed = r.success ? r.data : null;
        // Replay the bytes this tab persisted (validated above), not a re-serialised copy.
        original = r.success ? (json.command as AnyCommand) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== who.uid || parsed.gen !== who.gen || parsed.scope !== scope || scopeOf(parsed.command as AnyCommand) !== scope) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: original, error: COPY.resumeNote });
    },
    detach() {
      alive = false;
    },
  };
}

// ---- Form helpers ---------------------------------------------------------------------------------
/** Local datetime → ISO instant strictly in the future; null otherwise (the owner chooses it). */
export function futureInstant(local: string, now = Date.now()): string | null {
  if (!local) return null;
  const t = Date.parse(local);
  if (!Number.isFinite(t) || t <= now) return null;
  return new Date(t).toISOString();
}
/** Technicians that the server lists as active members (assignment choices). */
export const activeTechnicians = (members: Member[]) => members.filter((m) => m.active && m.role === "technician");
/** Actions shown from the SERVER-provided role (the server re-checks every one). */
export function teamActions(t: Team) {
  return { admin: t.active && t.role === "owner", assign: t.active && (t.role === "owner" || t.role === "coordinator"), invitationsVisible: t.role === "owner" };
}
