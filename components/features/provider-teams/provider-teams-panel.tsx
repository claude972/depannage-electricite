"use client";
// ART-12 provider teams in the artisan space: received invitations (accept / decline), teams the
// account belongs to, members / invitations / missions of a team, internal assignment of a mission
// already attributed to the holder, and the technician's own follow-up (no price, no payment, no
// documents — the contract exposes none). Actions are shown from the server-provided role and
// permissions only; every write goes through the identity-fenced runner of ./model.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { category, STATUS } from "../../app/format";
import type { Status } from "../../app/types";
import {
  ASSIGNMENT_LABEL,
  COPY,
  INVITATION_LABEL,
  ROLE_LABEL,
  RUNNER_INITIAL,
  activeTechnicians,
  createPtApi,
  createRunner,
  futureInstant,
  parseMission,
  parseMyInvitations,
  parseTeamPage,
  parseTeams,
  ptUuid,
  tabStore,
  teamActions,
  type AnyCommand,
  type Context,
  type Member,
  type Mission,
  type MyInvitation,
  type PtApi,
  type RunnerState,
  type Section,
  type Store,
  type Team,
  type TeamInvitation,
  type TeamMission,
} from "./model";
import styles from "./provider-teams.module.css";

export type ProviderTeamsPanelProps = {
  context: Context;
  /** "artisan": full entry (team creation for an approved holder). "member": client / manager accounts
   *  invited into a team — no creation, and the block exists only when the server returns an
   *  invitation or a membership for this account (no promotion, no new right). */
  audience?: "artisan" | "member";
  demo?: boolean;
  api?: PtApi;
  store?: () => Store | null;
  newId?: () => string | null;
  now?: () => number;
};
type Deps = { api: () => PtApi; store: () => Store | null; context: Context; newId: () => string | null; now: () => number };
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const jobLabel = (c: string, s: string, city: string) => `${category(c).label} · ${STATUS[s as Status] ?? s}${city ? ` · ${city}` : ""}`;

export function ProviderTeamsPanel(props: ProviderTeamsPanelProps) {
  if (props.demo && props.audience === "member") return null; // nothing to show without server data
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="provider-teams-demo" data-provider-teams="demo">
        <h2 id="provider-teams-demo" className={styles.title}>{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

/** Runner per scope, created per effect run (StrictMode-safe). */
function useRunner(deps: Deps, scope: string, after: () => Promise<void>, onForbidden: () => void) {
  const [state, setRaw] = useState<RunnerState>(RUNNER_INITIAL);
  const ref = useRef(state);
  const set = (s: RunnerState) => {
    ref.current = s;
    setRaw(s);
  };
  const cb = useRef({ after, onForbidden });
  cb.current = { after, onForbidden };
  const runner = useRef<ReturnType<typeof createRunner> | null>(null);
  useEffect(() => {
    const r = createRunner({ api: deps.api, store: deps.store, context: deps.context, scope, get: () => ref.current, set, after: () => cb.current.after(), onForbidden: () => cb.current.onForbidden() });
    runner.current = r;
    r.restore();
    return () => {
      r.detach();
      if (runner.current === r) runner.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  return { state, run: (cmd: AnyCommand) => runner.current?.run(cmd) ?? Promise.resolve("ignored" as const), retry: () => void runner.current?.retry() };
}

function RunnerFeedback({ state, onRetry }: { state: RunnerState; onRetry: () => void }) {
  return (
    <>
      {state.notice && <p className={styles.note} role="status" data-pt-notice="">{state.notice}</p>}
      {state.error && (
        <div role="alert" data-pt-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={onRetry} data-pt-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

function Live({ context, audience = "artisan", api, store = tabStore, newId = ptUuid, now = Date.now }: ProviderTeamsPanelProps) {
  const member = audience === "member";
  const [invitationCount, setInvitationCount] = useState<number | null>(null);
  const latest = useRef({ api, store, newId, now });
  latest.current = { api, store, newId, now };
  const client = useRef<PtApi | null>(null);
  const deps: Deps = {
    api: () => (client.current ??= latest.current.api ?? createPtApi()),
    store: () => latest.current.store(),
    context,
    newId: () => latest.current.newId(),
    now: () => latest.current.now(),
  };
  const [teams, setTeams] = useState<{ phase: "loading" | "ready" | "error" | "forbidden"; records: Team[]; next: string | null }>({ phase: "loading", records: [], next: null });
  const [selected, setSelected] = useState<string | null>(null);
  const loadTeams = async (after: string | null = null) => {
    const gen = context.generation(), uid = context.userId();
    const r = await deps.api().teams(after);
    if (context.generation() !== gen || context.userId() !== uid) return;
    if (r.status === 401 || r.status === 403) return setTeams({ phase: "forbidden", records: [], next: null });
    const p = r.status === 200 ? parseTeams(r.body, after) : null;
    if (!p) return setTeams((s) => ({ ...s, phase: "error" }));
    setTeams((s) => ({ phase: "ready", records: after ? [...s.records, ...p.records] : p.records, next: p.next_after }));
  };
  useEffect(() => {
    let active = true;
    void (async () => active && (await loadTeams()))();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const uid = useId();
  const create = useRunner(deps, "create", () => loadTeams(), () => setTeams({ phase: "forbidden", records: [], next: null }));
  const [name, setName] = useState("");
  const team = teams.records.find((t) => t.id === selected) ?? null;
  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const teamId = deps.newId(), commandId = deps.newId();
    if (!teamId || !commandId) return;
    if ((await create.run({ kind: "create", body: { action: "create", team_id: teamId.toLowerCase(), command_id: commandId.toLowerCase(), name: n } })) === "ok") setName("");
  };
  // Member accounts: the block exists only when the server returns something for this account.
  const hidden = member && (invitationCount === null || teams.phase === "loading" || (invitationCount === 0 && teams.records.length === 0 && teams.phase !== "error"));
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-provider-teams="live" data-pt-audience={audience} hidden={hidden || undefined}>
      <h2 id={`${uid}-title`} className={styles.title}>{COPY.title}</h2>
      <p className={styles.muted}>{COPY.roleNote}</p>
      <MyInvitations deps={deps} onAccepted={() => void loadTeams()} onCount={setInvitationCount} />
      {teams.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {teams.phase === "forbidden" && <p className={styles.muted}>{COPY.forbidden}</p>}
      {teams.phase === "error" && (
        <div role="alert">
          <p className={styles.error}>{COPY.loadFailed}</p>
          <button type="button" className={styles.button} onClick={() => void loadTeams()}>Réessayer</button>
        </div>
      )}
      {teams.phase === "ready" && (
        <>
          <h3 className={styles.subtitle}>Mes équipes</h3>
          {teams.records.length === 0 && <p className={styles.muted} data-pt-noteam="">{COPY.noTeam}</p>}
          <ul className={styles.list}>
            {teams.records.map((t) => (
              <li key={t.id} className={styles.item} data-pt-team={t.id}>
                <span>
                  <strong>{t.name}</strong> · {ROLE_LABEL[t.role]}{t.active ? "" : " · inactive"}
                </span>
                <button type="button" className={styles.button} aria-pressed={selected === t.id} onClick={() => setSelected(selected === t.id ? null : t.id)} data-pt-open={t.id}>
                  {selected === t.id ? "Fermer" : "Ouvrir"}
                </button>
              </li>
            ))}
          </ul>
          {teams.next && <button type="button" className={styles.button} onClick={() => void loadTeams(teams.next)}>{COPY.more}</button>}
          {!member && (
          <form className={styles.form} onSubmit={(e) => void submitCreate(e)} noValidate data-pt-create="">
            <label className={styles.label} htmlFor={`${uid}-name`}>Créer une équipe (titulaire artisan approuvé)</label>
            <span className={styles.row}>
              <input id={`${uid}-name`} className={styles.input} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} disabled={create.state.busy || !!create.state.pending} />
              <button type="submit" className={styles.button} disabled={!name.trim() || create.state.busy || !!create.state.pending}>Créer</button>
            </span>
          </form>
          )}
          <RunnerFeedback state={create.state} onRetry={create.retry} />
        </>
      )}
      {team && <TeamDetail key={team.id} deps={deps} initialTeam={team} onTeamChanged={() => void loadTeams()} />}
    </section>
  );
}

function MyInvitations({ deps, onAccepted, onCount }: { deps: Deps; onAccepted: () => void; onCount?: (n: number) => void }) {
  const [state, setState] = useState<{ phase: "loading" | "ready" | "error" | "forbidden"; records: MyInvitation[] }>({ phase: "loading", records: [] });
  const load = async () => {
    const gen = deps.context.generation(), uid = deps.context.userId();
    const r = await deps.api().invitations(null);
    if (deps.context.generation() !== gen || deps.context.userId() !== uid) return;
    if (r.status === 401 || r.status === 403) return setState({ phase: "forbidden", records: [] });
    const p = r.status === 200 ? parseMyInvitations(r.body, null) : null;
    setState(p ? { phase: "ready", records: p.records } : { phase: "error", records: [] });
    onCount?.(p ? p.records.length : -1); // -1: read failed ⇒ the block shows the honest error
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const runner = useRunner(deps, "invitation", async () => {
    await load();
    onAccepted();
  }, () => setState({ phase: "forbidden", records: [] }));
  const answer = (inv: MyInvitation, action: "accept_invitation" | "decline_invitation") => {
    const cid = deps.newId();
    if (!cid) return;
    void runner.run({ kind: "invitation", body: { action, team_id: inv.team_id, invitation_id: inv.id, command_id: cid.toLowerCase() } });
  };
  const locked = runner.state.busy || !!runner.state.pending;
  return (
    <div className={styles.block} data-pt-invitations="">
      <h3 className={styles.subtitle}>{COPY.invitationsTitle}</h3>
      {state.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {state.phase === "error" && <p className={styles.error} role="alert">{COPY.loadFailed}</p>}
      {state.phase === "forbidden" && <p className={styles.muted}>{COPY.forbidden}</p>}
      {state.phase === "ready" && state.records.length === 0 && <p className={styles.muted}>{COPY.noInvitations}</p>}
      <ul className={styles.list}>
        {state.records.map((inv) => (
          <li key={inv.id} className={styles.item} data-pt-invitation={inv.id}>
            <span>
              <strong>{inv.team_name}</strong> · {ROLE_LABEL[inv.role]} · expire le {when(inv.expires_at)}
              {!inv.team_active && " · équipe inactive"}
            </span>
            <span className={styles.row}>
              <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !inv.team_active} onClick={() => answer(inv, "accept_invitation")} data-pt-accept={inv.id}>Accepter</button>
              <button type="button" className={styles.button} disabled={locked} onClick={() => answer(inv, "decline_invitation")} data-pt-decline={inv.id}>Refuser</button>
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{COPY.invitationNote}</p>
      <RunnerFeedback state={runner.state} onRetry={runner.retry} />
    </div>
  );
}

type Pages = { members: Member[]; invitations: TeamInvitation[]; missions: TeamMission[] };
function TeamDetail({ deps, initialTeam, onTeamChanged }: { deps: Deps; initialTeam: Team; onTeamChanged: () => void }) {
  const uid = useId();
  const [team, setTeam] = useState<Team>(initialTeam);
  const [pages, setPages] = useState<Pages>({ members: [], invitations: [], missions: [] });
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "forbidden">("loading");
  const [tab, setTab] = useState<Section>("missions");
  const [openMission, setOpenMission] = useState<string | null>(null);
  const actions = teamActions(team);
  const loadSection = async (section: Section) => {
    const gen = deps.context.generation(), who = deps.context.userId();
    const r = await deps.api().team(team.id, section, null);
    if (deps.context.generation() !== gen || deps.context.userId() !== who) return null;
    if (r.status === 401 || r.status === 403) return "forbidden" as const;
    const p = r.status === 200 ? parseTeamPage(r.body, team.id, section, null) : null;
    if (!p) return "error" as const;
    setTeam(p.team);
    setPages((s) => ({ ...s, [section]: p.records }));
    return "ok" as const;
  };
  const reload = async () => {
    const wanted: Section[] = ["members", "missions", ...(teamActions(team).invitationsVisible ? (["invitations"] as Section[]) : [])];
    const out = await Promise.all(wanted.map(loadSection));
    if (out.some((o) => o === "forbidden")) setPhase("forbidden");
    else if (out.some((o) => o === "error")) setPhase("error");
    else if (out.every((o) => o === "ok")) setPhase("ready");
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const runner = useRunner(deps, `team:${team.id.toLowerCase()}`, async () => {
    await reload();
    onTeamChanged();
  }, () => setPhase("forbidden"));
  const run = (build: (cid: string) => AnyCommand | null) => {
    const cid = deps.newId();
    if (!cid) return Promise.resolve("ignored" as const);
    const cmd = build(cid.toLowerCase());
    return cmd ? runner.run(cmd) : Promise.resolve("ignored" as const);
  };
  const locked = runner.state.busy || !!runner.state.pending;
  const [invite, setInvite] = useState({ email: "", role: "technician" as "coordinator" | "technician", expires: "" });
  const [inviteError, setInviteError] = useState("");
  const [rename, setRename] = useState("");
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  if (phase === "forbidden") return <p className={styles.muted} data-pt-team-forbidden="">{COPY.forbidden}</p>;
  const technicians = activeTechnicians(pages.members);
  const tabs: [Section, string][] = [["missions", "Interventions"], ["members", "Membres"], ...(actions.invitationsVisible ? ([["invitations", "Invitations envoyées"]] as [Section, string][]) : [])];
  return (
    <div className={styles.team} data-pt-detail={team.id} data-pt-role={team.role}>
      <h3 className={styles.subtitle}>{team.name} · {ROLE_LABEL[team.role]} · version {team.version}</h3>
      {team.role === "technician" && <p className={styles.muted} data-pt-technician-note="">{COPY.technicianNote}</p>}
      <div className={styles.row} role="tablist" aria-label="Sections de l’équipe">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${styles.button} ${tab === k ? styles.tabActive : ""}`} onClick={() => setTab(k)} data-pt-tab={k}>{label}</button>
        ))}
      </div>
      {phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {phase === "error" && (
        <div role="alert">
          <p className={styles.error}>{COPY.loadFailed}</p>
          <button type="button" className={styles.button} onClick={() => void reload()}>Réessayer</button>
        </div>
      )}
      <RunnerFeedback state={runner.state} onRetry={runner.retry} />
      {phase === "ready" && tab === "members" && (
        <div className={styles.block}>
          <ul className={styles.list}>
            {pages.members.map((m) => (
              <li key={m.id} className={styles.item} data-pt-member={m.id}>
                <span>{m.full_name || "Membre"} · {ROLE_LABEL[m.role]}{m.active ? "" : " · retiré"}</span>
                {actions.admin && m.role !== "owner" && m.active && (
                  <span className={styles.row}>
                    <button type="button" className={styles.button} disabled={locked} onClick={() => void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "set_role", command_id: cid, expected_version: team.version, user_id: m.id, role: m.role === "technician" ? "coordinator" : "technician" } }))} data-pt-setrole={m.id}>
                      Passer {m.role === "technician" ? "coordinateur" : "technicien"}
                    </button>
                    <button type="button" className={styles.button} disabled={locked || removing === m.id} onClick={() => setRemoving(m.id)} data-pt-remove={m.id}>
                      Retirer…
                    </button>
                  </span>
                )}
                {removing === m.id && (
                  <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-rm-${m.id}`} data-pt-remove-confirm={m.id}>
                    <p id={`${uid}-rm-${m.id}`}>Retirer {m.full_name || "ce membre"} de l’équipe ? Son affectation courante sera retirée ; l’historique est conservé.</p>
                    <span className={styles.row}>
                      <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "remove_member", command_id: cid, expected_version: team.version, user_id: m.id } })).then(() => setRemoving(null))} data-pt-remove-execute={m.id}>
                        Confirmer le retrait
                      </button>
                      <button type="button" className={styles.button} disabled={runner.state.busy} onClick={() => setRemoving(null)}>Annuler</button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {actions.admin && (
            <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); const n = rename.trim(); if (n) void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "rename", command_id: cid, expected_version: team.version, name: n } })).then((o) => o === "ok" && setRename("")); }} data-pt-rename="">
              <label className={styles.label} htmlFor={`${uid}-rename`}>Renommer l’équipe</label>
              <span className={styles.row}>
                <input id={`${uid}-rename`} className={styles.input} value={rename} maxLength={160} onChange={(e) => setRename(e.target.value)} disabled={locked} />
                <button type="submit" className={styles.button} disabled={locked || !rename.trim()}>Renommer</button>
              </span>
            </form>
          )}
        </div>
      )}
      {phase === "ready" && tab === "invitations" && actions.invitationsVisible && (
        <div className={styles.block}>
          <ul className={styles.list}>
            {pages.invitations.map((inv) => (
              <li key={inv.id} className={styles.item} data-pt-sent={inv.id}>
                <span>{inv.email} · {ROLE_LABEL[inv.role]} · {INVITATION_LABEL[inv.status]}{inv.expired ? " · expirée" : ` · expire le ${when(inv.expires_at)}`}</span>
                {actions.admin && inv.status === "pending" && !inv.expired && (
                  <button type="button" className={styles.button} disabled={locked} onClick={() => void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "revoke_invitation", command_id: cid, expected_version: team.version, invitation_id: inv.id } }))} data-pt-revoke={inv.id}>Révoquer</button>
                )}
              </li>
            ))}
          </ul>
          {pages.invitations.length === 0 && <p className={styles.muted}>Aucune invitation envoyée.</p>}
          {actions.admin && (
            <form
              className={styles.form}
              noValidate
              data-pt-invite=""
              onSubmit={(e) => {
                e.preventDefault();
                const email = invite.email.trim().toLowerCase();
                const expires = futureInstant(invite.expires, deps.now());
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return setInviteError("Adresse e-mail invalide.");
                if (!expires) return setInviteError("Choisissez une date d’expiration dans le futur.");
                const invitationId = deps.newId();
                if (!invitationId) return;
                setInviteError("");
                void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "invite", command_id: cid, expected_version: team.version, invitation_id: invitationId.toLowerCase(), email, role: invite.role, expires_at: expires } })).then((o) => o === "ok" && setInvite({ email: "", role: "technician", expires: "" }));
              }}
            >
              <h4 className={styles.subtitle}>Inviter une personne nommée</h4>
              <label className={styles.label} htmlFor={`${uid}-email`}>E-mail confirmé de la personne</label>
              <input id={`${uid}-email`} className={styles.input} type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} disabled={locked} />
              <label className={styles.label} htmlFor={`${uid}-role`}>Rôle dans l’équipe</label>
              <select id={`${uid}-role`} className={styles.input} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as "coordinator" | "technician" })} disabled={locked}>
                <option value="technician">Technicien</option>
                <option value="coordinator">Coordinateur</option>
              </select>
              <label className={styles.label} htmlFor={`${uid}-exp`}>Expiration de l’invitation</label>
              <input id={`${uid}-exp`} className={styles.input} type="datetime-local" value={invite.expires} onChange={(e) => setInvite({ ...invite, expires: e.target.value })} disabled={locked} />
              <small className={styles.muted}>{COPY.expiresNote}</small>
              {inviteError && <small className={styles.error}>{inviteError}</small>}
              <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={locked}>Inviter</button>
            </form>
          )}
        </div>
      )}
      {phase === "ready" && tab === "missions" && (
        <div className={styles.block}>
          {actions.assign && <p className={styles.muted}>{COPY.assignNote}</p>}
          {pages.missions.length === 0 && <p className={styles.muted}>Aucune intervention visible pour votre rôle dans cette équipe.</p>}
          <ul className={styles.list}>
            {pages.missions.map((job) => {
              const a = job.assignment;
              const current = a?.technician_id ? pages.members.find((m) => m.id === a.technician_id) : undefined;
              return (
                <li key={job.id} className={styles.item} data-pt-mission={job.id}>
                  <span>
                    {jobLabel(job.category, job.status, job.city)} · {a ? `${ASSIGNMENT_LABEL[a.state]}${current ? ` (${current.full_name})` : ""}` : "Non affecté"}
                  </span>
                  <span className={styles.row}>
                    <button type="button" className={styles.button} onClick={() => setOpenMission(openMission === job.id ? null : job.id)} data-pt-mission-open={job.id}>{openMission === job.id ? "Fermer le suivi" : "Suivi"}</button>
                    {actions.assign && (!a || a.state === "unassigned") && technicians.length > 0 && (
                      <>
                        <select className={styles.input} aria-label="Technicien à affecter" value={assignTo[job.id] ?? ""} onChange={(e) => setAssignTo({ ...assignTo, [job.id]: e.target.value })} disabled={locked}>
                          <option value="">Choisir un technicien…</option>
                          {technicians.map((t) => (
                            <option key={t.id} value={t.id}>{t.full_name || t.id.slice(0, 8)}</option>
                          ))}
                        </select>
                        <button type="button" className={styles.button} disabled={locked || !assignTo[job.id]} onClick={() => void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "assign", command_id: cid, expected_version: a ? a.version : null, intervention_id: job.id, technician_id: assignTo[job.id] } }))} data-pt-assign={job.id}>Affecter</button>
                      </>
                    )}
                    {actions.assign && a && a.state !== "unassigned" && (
                      <button type="button" className={styles.button} disabled={locked} onClick={() => void run((cid) => ({ kind: "team", teamId: team.id, body: { action: "unassign", command_id: cid, expected_version: a.version, intervention_id: job.id } }))} data-pt-unassign={job.id}>Retirer l’affectation</button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {openMission && <MissionFollowUp key={openMission} deps={deps} teamId={team.id} jobId={openMission} run={run} locked={locked} />}
        </div>
      )}
    </div>
  );
}

/** Technician follow-up of ONE mission: intervention facts, appointment, assignment; no price,
 *  payment or document exists in this contract. Acknowledge / done only with server permissions. */
export function MissionFollowUp({ deps, teamId, jobId, run, locked, initial }: { deps: Deps; teamId: string; jobId: string; run: (build: (cid: string) => AnyCommand | null) => Promise<unknown>; locked: boolean; initial?: Mission }) {
  const [state, setState] = useState<{ phase: "loading" | "ready" | "error" | "forbidden"; data: Mission | null }>(initial ? { phase: "ready", data: initial } : { phase: "loading", data: null });
  const [note, setNote] = useState("");
  const load = async () => {
    const gen = deps.context.generation(), who = deps.context.userId();
    const r = await deps.api().mission(teamId, jobId);
    if (deps.context.generation() !== gen || deps.context.userId() !== who) return;
    if (r.status === 401 || r.status === 403) return setState({ phase: "forbidden", data: null });
    const p = r.status === 200 ? parseMission(r.body, teamId, jobId) : null;
    setState(p ? { phase: "ready", data: p } : { phase: "error", data: null });
  };
  useEffect(() => {
    if (!initial) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state.phase === "loading") return <p className={styles.muted} role="status">{COPY.loading}</p>;
  if (state.phase === "forbidden") return <p className={styles.muted}>{COPY.forbidden}</p>;
  if (state.phase === "error" || !state.data)
    return (
      <div role="alert">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void load()}>Réessayer</button>
      </div>
    );
  const m = state.data, a = m.assignment, i = m.intervention;
  const progress = (s: "acknowledged" | "done") =>
    a && void run((cid) => ({ kind: "team", teamId, body: { action: "progress", command_id: cid, expected_version: a.version, intervention_id: jobId, state: s, note: note.trim() } })).then(() => load());
  return (
    <article className={styles.mission} aria-label="Suivi interne de l’intervention" data-pt-followup={jobId}>
      <h4 className={styles.subtitle}>{category(i.category).label} · {STATUS[i.status as Status] ?? i.status}</h4>
      <p className={styles.text}>{i.description}</p>
      <dl className={styles.kv}>
        <dt>Adresse</dt>
        <dd>{i.address}, {i.postal_code} {i.city}</dd>
        <dt>Rendez-vous</dt>
        <dd>{m.appointment ? `${when(m.appointment.starts_at)} – ${when(m.appointment.ends_at)}` : "Aucun créneau enregistré"}</dd>
        <dt>Suivi interne</dt>
        <dd>{a ? `${ASSIGNMENT_LABEL[a.state]} · mis à jour le ${when(a.updated_at)}` : "Non affecté"}</dd>
        {a?.note && (
          <>
            <dt>Note</dt>
            <dd>{a.note}</dd>
          </>
        )}
      </dl>
      {(m.permissions.can_acknowledge || m.permissions.can_complete) && a && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor={`note-${jobId}`}>Note de suivi (facultative)</label>
          <textarea id={`note-${jobId}`} className={styles.input} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} />
          <span className={styles.row}>
            {m.permissions.can_acknowledge && <button type="button" className={styles.button} disabled={locked} onClick={() => progress("acknowledged")} data-pt-ack="">Prendre en compte</button>}
            {m.permissions.can_complete && <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => progress("done")} data-pt-done="">Terminer mon suivi</button>}
          </span>
          <small className={styles.muted}>{COPY.doneNote}</small>
        </div>
      )}
    </article>
  );
}
