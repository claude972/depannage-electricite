"use client";
// ADM-07 composer: an operator reply in a dossier thread (POST /api/admin/messages). One send at a
// time; the same command (id + text) is resent on « Réessayer » so a lost reply never duplicates;
// a reply is dropped if the identity changed or the composer is gone.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field } from "../../app/ui";
import type { Message } from "../../app/types";
import {
  ADMIN_REPLY_MAX,
  REPLY_COPY,
  conversationOpen,
  createReplyApi,
  nextCommand,
  replyOutcome,
  replyText,
  replyUuid,
  type ReplyApi,
  type ReplyCommand,
} from "./admin-reply-model";

type Props = {
  intervention: { id: string; artisan_id?: string | null; status?: string };
  demo: boolean;
  context: { generation(): number; userId(): string | null };
  onSent: (message: Message) => void;
  onRefresh: () => void;
  api?: ReplyApi;
  newId?: () => string | null;
};

type Notice = { tone: "error" | "ok"; text: string; retry?: boolean; refresh?: boolean } | null;

export function AdminReplyComposer({ intervention, demo, context, onSent, onRefresh, api, newId = replyUuid }: Props) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pending = useRef<ReplyCommand | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const client = useRef<ReplyApi>(api ?? createReplyApi());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (demo) return <p className="muted" data-admin-reply="demo">{REPLY_COPY.demo}</p>;
  if (!conversationOpen(intervention)) return <p className="muted" data-admin-reply="closed">{REPLY_COPY.unavailable}</p>;

  const text = replyText(draft);
  const send = async () => {
    if (inFlight.current) return;
    if (!text) {
      setNotice({ tone: "error", text: REPLY_COPY.invalid });
      return;
    }
    const command = nextCommand(pending.current, intervention.id, text, newId);
    if (!command) {
      setNotice({ tone: "error", text: REPLY_COPY.noUuid });
      return;
    }
    pending.current = command;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const gen = context.generation(), uid = context.userId();
    const result = await client.current.send(command);
    inFlight.current = false;
    if (!mounted.current || context.generation() !== gen || context.userId() !== uid) return;
    setBusy(false);
    const outcome = replyOutcome(result, command, uid);
    if (outcome.kind === "sent") {
      pending.current = null;
      setDraft("");
      setNotice({ tone: "ok", text: REPLY_COPY.sent });
      onSent(outcome.message);
      return;
    }
    if (outcome.kind === "conflict") {
      pending.current = null; // a resend after refresh uses a new id
      setNotice({ tone: "error", text: outcome.text, refresh: true });
      return;
    }
    setNotice({ tone: "error", text: outcome.text, retry: outcome.kind === "retry" });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };
  const remaining = ADMIN_REPLY_MAX - draft.trim().length;

  return (
    <form onSubmit={submit} data-admin-reply="open" aria-busy={busy || undefined} noValidate>
      <Field label="Répondre dans le fil (signé « Exploitant »)" hint={`Visible par le client et l’artisan du dossier. ${remaining >= 0 ? `${remaining} caractères restants.` : ""}`}>
        <textarea
          rows={3}
          value={draft}
          disabled={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            if (notice?.tone === "ok") setNotice(null);
          }}
        />
      </Field>
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} data-admin-reply-notice={notice.tone}>
          {notice.text}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button primary" disabled={busy || !text}>
          {busy ? "Envoi…" : notice?.retry ? "Réessayer" : "Envoyer"}
        </button>
        {notice?.refresh && (
          <button type="button" className="button outline" onClick={onRefresh}>
            Actualiser le dossier
          </button>
        )}
      </div>
    </form>
  );
}
