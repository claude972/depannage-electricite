"use client";
// E59/E60 — intervention report evidence (contract A: GET/POST /api/interventions/[id]/operations).
// GET adds `report_evidence_required` (new interventions only) and `report_receipt` (the requester's
// acknowledgement of the CURRENT `report.report_revision`, or null). POST `save_report` accepts
// `before_photo_id` / `after_photo_id`; POST `sign_report` records the requester's acknowledgement +
// typed name for one revision (409 when the revision changed). The client acknowledgement never
// blocks completion nor payment; only the two photos of a new intervention gate « Terminer ».
// Legacy / demo dossiers (flag absent or false) keep their previous behaviour.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InterventionReport, Operations, ReportReceipt, StoredDocument } from "./types";
import { reportDeclarant } from "./report-declarant";
import { api } from "./api";
import { PHOTO_COPY, uploadPhoto } from "./message-photo";

export type EvidencePhoto = { id: string; name: string };

/** Formats the server accepts as report photos (JPEG, PNG, WebP). */
const EVIDENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Candidates for the « avant » / « après » photos: JPEG/PNG/WebP documents of THIS dossier owned by
 * the assigned artisan (when `owner_id` is projected; the server refuses a client photo anyway).
 */
export function dossierPhotos(documents: readonly StoredDocument[], interventionId: string, artisanId?: string | null): EvidencePhoto[] {
  return documents
    .filter((d) => d.intervention_id === interventionId && EVIDENCE_TYPES.has((d.mime_type || "").toLowerCase()))
    .filter((d) => !d.owner_id || (artisanId ? d.owner_id === artisanId : false))
    .map((d) => ({ id: d.id, name: d.name }));
}

type OpenContext = { generation(): number; userId(): string | null };

/** Opens one report photo through the existing private document link (GET /api/documents?id=). */
function PhotoOpen({ id, context }: { id: string; context: OpenContext }) {
  const [state, setState] = useState<"idle" | "opening" | "error">("idle");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function open() {
    if (inFlight.current) return;
    const user = context.userId();
    const generation = context.generation();
    if (!user) return;
    inFlight.current = true;
    setState("opening");
    const current = () => user === context.userId() && generation === context.generation();
    try {
      const result = await api<{ url: string }>(`/api/documents?id=${encodeURIComponent(id)}`, undefined, "GET");
      if (!current()) return;
      if (typeof result?.url !== "string" || !result.url.startsWith("https://")) throw new Error("Le lien de la photo est indisponible.");
      window.open(result.url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch (e) {
      if (!current()) return;
      setMessage((e as Error).message || "La photo n’a pas pu être ouverte.");
      setState("error");
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <>
      {" "}
      <button type="button" className="text-button" data-report-photo-open={id} disabled={state === "opening"} onClick={() => void open()} style={{ minHeight: 44 }}>
        {state === "opening" ? "Ouverture…" : state === "error" ? "Réessayer l’ouverture" : "Ouvrir"}
      </button>
      {state === "error" && (
        <span role="alert" className="form-error" data-report-photo-error>
          {" "}
          {message}
        </span>
      )}
    </>
  );
}

/** True only when the server flagged the dossier (new interventions); absent ⇒ legacy behaviour. */
export const evidenceRequired = (ops: Operations | null | undefined) => ops?.report_evidence_required === true;

/** Receipt of the report revision shown (a receipt of an older revision is not current). */
export function currentReceipt(ops: Operations | null | undefined): ReportReceipt | null {
  const revision = ops?.report?.report_revision;
  const receipt = ops?.report_receipt;
  return revision && receipt && receipt.report_revision === revision ? receipt : null;
}

/**
 * What still prevents « Terminer l’intervention » on a new intervention (empty = nothing).
 * Legacy dossiers (flag false/absent) are never gated here; the server stays the authority.
 */
export function closureMissing(ops: Operations | null | undefined): string[] {
  if (!evidenceRequired(ops)) return [];
  const report = ops?.report;
  const missing: string[] = [];
  if (!report) missing.push("le compte rendu enregistré");
  if (!report?.before_photo_id) missing.push("la photo avant l’intervention");
  if (!report?.after_photo_id) missing.push("la photo après l’intervention");
  return missing;
}

const when = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/**
 * Read-only evidence block shared by every role: declared name (never a client signature), the
 * before/after photos when recorded, and the acknowledgement state of the current revision.
 */
export function ReportEvidenceSummary({ ops, report, photos, noteClass, declarant = true, openContext, receiptVisible }: {
  ops: Operations; report: InterventionReport; photos?: readonly EvidencePhoto[]; noteClass?: string; declarant?: boolean;
  /** Live session: photos open through the private document link. Absent (demo) ⇒ names only. */ openContext?: OpenContext;
  /**
   * Whether this reader may see the acknowledgement state: only the requester and the assigned
   * artisan (receipt RLS). Other readers (super admin, non-requesting members) get
   * `report_receipt: null` even when signed ⇒ no status at all, never a false « en attente ».
   */
  receiptVisible: boolean;
}) {
  const name = (id?: string | null) => (id ? photos?.find((p) => p.id === id)?.name ?? "photo jointe au dossier" : "");
  const receipt = receiptVisible ? currentReceipt(ops) : null;
  const versioned = receiptVisible && Boolean(report.report_revision);
  return (
    <div data-report-evidence={receipt ? "signed" : versioned ? "pending" : receiptVisible ? "legacy" : "hidden"}>
      {declarant && <p className={noteClass ?? "form-note"}>{reportDeclarant(report.signature_name, report.updated_at ? when(report.updated_at) : undefined)}</p>}
      {(report.before_photo_id || report.after_photo_id || evidenceRequired(ops)) && (
        <ul className={noteClass ?? "form-note"} data-report-photos style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          <li data-report-photo="before">
            Photo avant : {report.before_photo_id ? name(report.before_photo_id) : "non fournie"}
            {report.before_photo_id && openContext && <PhotoOpen key={report.before_photo_id} id={report.before_photo_id} context={openContext} />}
          </li>
          <li data-report-photo="after">
            Photo après : {report.after_photo_id ? name(report.after_photo_id) : "non fournie"}
            {report.after_photo_id && openContext && <PhotoOpen key={report.after_photo_id} id={report.after_photo_id} context={openContext} />}
          </li>
        </ul>
      )}
      {receipt ? (
        <p className={noteClass ?? "form-note"} data-report-receipt="signed">
          <strong>Accusé de réception signé</strong> par {receipt.signature_name}
          {receipt.signed_at ? ` le ${when(receipt.signed_at)}` : ""}
          {" "}(nom saisi par le demandeur authentifié, pour cette version du compte rendu).
        </p>
      ) : versioned ? (
        <p className={noteClass ?? "form-note"} data-report-receipt="pending">
          Accusé de réception du demandeur en attente. Il ne bloque ni la fin de l’intervention ni le paiement.
        </p>
      ) : null}
    </div>
  );
}

export type SignReportValues = { report_revision: string; acknowledged: true; signature_name: string };

/**
 * Requester acknowledgement + typed signature of ONE report revision. Mounted only for the
 * authenticated requester of a completed / paid dossier whose current revision is not signed yet;
 * keyed by identity + dossier + revision by the caller, so nothing survives a change of either.
 */
export function ReportReceiptForm({ revision, scope, busy, onSign }: { revision: string; scope: string; busy: boolean; onSign: (values: SignReportValues) => Promise<boolean> }) {
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(true);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingRef.current) return;
    const typed = name.trim();
    if (!checked) return setError("Cochez la case pour confirmer avoir pris connaissance du compte rendu.");
    if (typed.length < 2 || typed.length > 120) return setError("Saisissez votre nom (2 à 120 caractères).");
    setError("");
    savingRef.current = true;
    setSaving(true);
    const sent = scope;
    void onSign({ report_revision: revision, acknowledged: true, signature_name: typed })
      .catch(() => false)
      .then((ok) => {
        if (!mounted.current || scopeRef.current !== sent) return;
        savingRef.current = false;
        setSaving(false);
        // Success: the caller re-reads the dossier and unmounts this form (receipt shown).
        // No claim about a re-read here: the caller's GET may itself fail. Explicit retry only.
        if (!ok) setError("L’accusé n’a pas été enregistré. Vérifiez le compte rendu affiché, puis réessayez.");
      });
  }
  return (
    <form onSubmit={submit} data-report-receipt-form={saving ? "saving" : "idle"} aria-busy={saving || undefined} style={{ marginTop: 12 }}>
      <fieldset disabled={saving || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 8 }}>Accusé de réception du compte rendu</legend>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} data-report-receipt-ack style={{ marginTop: 4 }} />
          <span>J’ai pris connaissance de ce compte rendu.</span>
        </label>
        <label className="field">
          <span>Votre nom (signature)</span>
          <input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} data-report-receipt-name />
        </label>
        {error && (
          <p role="alert" className="form-error" data-report-receipt-error>
            {error}
          </p>
        )}
        <p className="form-note">Facultatif : cet accusé ne conditionne ni la fin de l’intervention ni le paiement.</p>
        <button type="submit" className="button primary" style={{ minHeight: 44 }}>
          {saving ? "Enregistrement…" : "Signer l’accusé de réception"}
        </button>
      </fieldset>
    </form>
  );
}

/** Whether the requester form applies: authenticated requester, completed/paid, unsigned revision. */
export function canSignReport(ops: Operations | null | undefined, status: string, isRequester: boolean): ops is Operations & { report: InterventionReport & { report_revision: string } } {
  return Boolean(isRequester && ["completed", "paid"].includes(status) && ops?.report?.report_revision && !currentReceipt(ops));
}

export type ReportPhotoUploadProps = {
  interventionId: string;
  context: OpenContext;
  /** Re-reads the workspace so the new document becomes selectable. */
  refresh: () => Promise<void>;
  /** Confirmed upload (201 with the document id): kept by the form even before / without a refresh. */
  onUploaded: (photo: EvidencePhoto) => void;
};

/**
 * E59: private photo upload into THIS dossier, from the report form (no detour through « Mes
 * données »). Existing multipart POST /api/documents (file + intervention_id), JPEG/PNG/WebP only;
 * an unknown outcome is never retried automatically. Identity / generation fence on every reply.
 */
export function ReportPhotoUpload({ interventionId, context, refresh, onUploaded }: ReportPhotoUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "uploading" | "done" | "unknown" | "failed">("idle");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function send() {
    if (!file || inFlight.current) return;
    const user = context.userId();
    const generation = context.generation();
    if (!user) return;
    const current = () => user === context.userId() && generation === context.generation();
    inFlight.current = true;
    setState("uploading");
    setMessage("");
    try {
      const outcome = await uploadPhoto(file, interventionId, (url, init) => fetch(url, init));
      if (!current()) return;
      if (outcome.kind !== "ok") {
        setState(outcome.kind);
        setMessage(outcome.message);
        return;
      }
      const confirmed = { id: outcome.documentId, name: file.name };
      await refresh().catch(() => undefined);
      if (!current()) return;
      onUploaded(confirmed);
      setFile(null);
      if (input.current) input.current.value = "";
      setState("done");
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <div data-report-photo-upload={state} style={{ margin: "0 0 14px" }}>
      <label className="field">
        <span>Ajouter une photo au dossier</span>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          disabled={state === "uploading"}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            if (state !== "uploading") setState("idle");
          }}
          data-report-photo-file
        />
      </label>
      <button type="button" className="button outline" style={{ minHeight: 44 }} disabled={!file || state === "uploading"} onClick={() => void send()}>
        {state === "uploading" ? PHOTO_COPY.uploading : state === "unknown" ? PHOTO_COPY.reupload : "Envoyer la photo"}
      </button>
      {state === "done" && <p className="form-note" role="status">Photo ajoutée au dossier et sélectionnée.</p>}
      {(state === "unknown" || state === "failed") && (
        <p className="form-error" role="alert" data-report-photo-upload-error>
          {message}
        </p>
      )}
    </div>
  );
}
