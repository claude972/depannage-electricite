"use client";
// ADM-03 — searchable reassign picker (live). Reads approved artisans from the server directory
// (search + « Afficher plus »), never from the 100-row overview list; bound at render to identity +
// dossier + query; late replies are dropped. The chosen id goes to the existing reassign command.
import { useEffect, useId, useRef, useState } from "react";
import type { DirectoryFilters, DirectoryPage } from "../../app/types";
import { appendPage, artisanLabel, normalizeQuery, pickerInitial, type PickerArtisan, type PickerState } from "./artisan-picker-model";
import styles from "./artisan-picker.module.css";

export type DirectoryLoader = (
  kind: "artisans",
  params: DirectoryFilters & { limit?: number; cursor?: string | null },
) => Promise<DirectoryPage<"artisans"> | null>;

type Props = {
  context: { generation(): number; userId(): string | null };
  dossierId: string;
  load: DirectoryLoader;
  /** "" = back to « en attente d’attribution ». */
  value: string;
  onChange: (id: string, artisan: PickerArtisan | null) => void;
  /** Current artisan of the dossier, flagged in the list. */
  currentId: string | null;
};
const PAGE = 25;

export function ArtisanPicker({ context, dossierId, load, value, onChange, currentId }: Props) {
  const uid = context.userId();
  const identity = uid ? `${uid}|${context.generation()}|${dossierId}` : null;
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState<{ identity: string | null; q: string | null }>({ identity, q: null });
  const [invalid, setInvalid] = useState(false);
  const [nonce, setNonce] = useState(0);
  const q = query.identity === identity ? query.q : null;
  const key = identity ? `${identity}|${q ?? ""}|${nonce}` : null;
  const [state, setRaw] = useState<PickerState>(() => pickerInitial(""));
  const ref = useRef(state);
  const set = (s: PickerState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ load, context });
  useEffect(() => {
    latest.current = { load, context };
  });
  const keyOf = () => {
    const u = latest.current.context.userId();
    return u ? `${u}|${latest.current.context.generation()}|${dossierId}` : null;
  };
  const seq = useRef(0);
  useEffect(() => {
    if (!key) return;
    const my = ++seq.current;
    set(pickerInitial(key));
    void Promise.resolve()
      .then(() => latest.current.load("artisans", { approved: true, limit: PAGE, ...(q ? { q } : {}) }))
      .catch(() => null)
      .then((page) => {
        if (my !== seq.current || keyOf() !== identity) return; // stale: dropped
        set(page ? appendPage(pickerInitial(key), page) : { ...pickerInitial(key), phase: "error" });
      });
    // key carries identity + dossier + query + retry nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const more = () => {
    const s = ref.current;
    if (s.key !== key || s.phase !== "ready" || !s.next || s.loadingMore) return;
    const my = seq.current;
    const cursor = s.next;
    set({ ...s, loadingMore: true, moreError: false });
    void Promise.resolve()
      .then(() => latest.current.load("artisans", { approved: true, limit: PAGE, cursor, ...(q ? { q } : {}) }))
      .catch(() => null)
      .then((page) => {
        if (my !== seq.current || keyOf() !== identity || ref.current.key !== key) return;
        set(page ? appendPage(ref.current, page) : { ...ref.current, loadingMore: false, moreError: true });
      });
  };
  // Render fence: a state of another identity, dossier or query is never shown.
  const s = key && state.key === key ? state : pickerInitial(key ?? "");
  const inputId = useId();
  const search = () => {
    const n = normalizeQuery(draft);
    setInvalid(n.invalid);
    if (n.invalid) return;
    onChange("", null); // a new search never keeps a choice that may no longer be listed
    setQuery({ identity, q: n.q });
  };
  const name = `reassign-${dossierId}`;
  return (
    <div className={styles.picker} data-artisan-picker={s.phase}>
      <label htmlFor={inputId} className={styles.label}>
        Rechercher un artisan approuvé
      </label>
      <div className={styles.searchRow}>
        <input
          id={inputId}
          type="search"
          className={styles.input}
          value={draft}
          maxLength={80}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${inputId}-error` : `${inputId}-hint`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <button type="button" className={styles.button} onClick={search} data-picker-search="">
          Rechercher
        </button>
      </div>
      {invalid ? (
        <small id={`${inputId}-error`} className={styles.error} role="alert">
          Saisissez 2 à 80 caractères : lettres, chiffres, espaces, tirets ou apostrophes.
        </small>
      ) : (
        <small id={`${inputId}-hint`} className={styles.hint}>
          Nom ou identifiant. Seuls les artisans approuvés avec un dossier approuvé sont proposés.
        </small>
      )}
      <fieldset className={styles.options} aria-busy={s.phase === "loading" || s.loadingMore || undefined}>
        <legend className={styles.label}>Nouvel artisan</legend>
        <label className={styles.option}>
          <input type="radio" name={name} value="" checked={value === ""} onChange={() => onChange("", null)} />
          <span>Remettre en attente d’attribution</span>
        </label>
        {s.phase === "loading" && (
          <p className={styles.hint} role="status">
            Lecture de l’annuaire des artisans…
          </p>
        )}
        {s.phase === "error" && (
          <div className={styles.note} role="alert" data-picker-error="">
            <p>L’annuaire des artisans n’a pas pu être lu. Seule la remise en attente est possible pour le moment.</p>
            <button type="button" className={styles.button} onClick={() => setNonce((n) => n + 1)}>
              Réessayer
            </button>
          </div>
        )}
        {s.phase === "ready" && !s.items.length && (
          <p className={styles.hint} data-picker-empty="">
            {q ? `Aucun artisan approuvé ne correspond à « ${q} ».` : "Aucun artisan approuvé : seule la remise en attente est possible."}
          </p>
        )}
        {s.phase === "ready" &&
          s.items.map((a) => (
            <label key={a.id} className={styles.option} data-picker-option={a.id}>
              <input type="radio" name={name} value={a.id} checked={value === a.id} onChange={() => onChange(a.id, a)} />
              <span>
                {artisanLabel(a)}
                {a.id === currentId ? " (actuel)" : ""}
              </span>
            </label>
          ))}
      </fieldset>
      {s.phase === "ready" && s.total !== null && (
        <p className={styles.hint} data-picker-count="">
          {s.items.length} affiché{s.items.length > 1 ? "s" : ""} · {s.total} compte{s.total > 1 ? "s" : ""} artisan approuvé{s.total > 1 ? "s" : ""} au total{q ? " pour cette recherche" : ""}
        </p>
      )}
      {s.moreError && (
        <p className={styles.error} role="alert">
          La suite de l’annuaire n’a pas pu être chargée. Réessayez.
        </p>
      )}
      {s.phase === "ready" && s.next && (
        <button type="button" className={styles.button} disabled={s.loadingMore} onClick={more} data-picker-more="">
          {s.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}
