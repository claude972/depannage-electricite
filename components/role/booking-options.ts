"use client";
// Booking options (GET /api/bookings/options): which payment methods the server offers right now.
// Availability is decided by the server only; anything unexpected is read as « unavailable ».
// The reply still carries a `phone_auth` key for the native builds already delivered: the website
// ignores it (the website account is an e-mail address confirmed by its link).
import { useEffect, useState } from "react";

/** Deadline of an options request: a hung network never leaves the choice loading forever. */
export const OPTIONS_TIMEOUT_MS = 15_000;
export type PaymentMethodOption = { id: "on_site" | "card_hold"; available: boolean; label?: string; description?: string; reason?: string };
export type BookingOptions = { payment_methods: PaymentMethodOption[]; currency: string };
export type OptionsState = { status: "loading" } | { status: "error" } | { status: "ready"; options: BookingOptions };
export type OptionsApi = () => Promise<BookingOptions | null>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** Strict parse: anything unexpected ⇒ null (treated as « options unavailable », never as available). */
export function parseBookingOptions(body: unknown): BookingOptions | null {
  if (!isObj(body) || !Array.isArray(body.payment_methods)) return null;
  const methods: PaymentMethodOption[] = [];
  for (const m of body.payment_methods) {
    if (!isObj(m) || (m.id !== "on_site" && m.id !== "card_hold") || typeof m.available !== "boolean") return null;
    methods.push({ id: m.id, available: m.available, ...(typeof m.label === "string" ? { label: m.label } : {}), ...(typeof m.description === "string" ? { description: m.description } : {}), ...(typeof m.reason === "string" ? { reason: m.reason.slice(0, 300) } : {}) });
  }
  return { payment_methods: methods, currency: typeof body.currency === "string" ? body.currency : "eur" };
}

/** Same-origin GET with a deadline: aborted (AbortController) and settled as null when it passes. */
export function createOptionsApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = OPTIONS_TIMEOUT_MS } = {}): OptionsApi {
  return async () => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, timeoutMs);
    });
    const request = (async () => {
      try {
        const response = await fetcher("/api/bookings/options", { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
        const body: unknown = await response.json().catch(() => null);
        return response.status === 200 ? parseBookingOptions(body) : null;
      } catch {
        return null;
      }
    })();
    try {
      return await Promise.race([request, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Loads the options once (and on retry). Tests pass `initial` to render a given state. */
export function useBookingOptions(api?: OptionsApi, initial?: OptionsState): { options: OptionsState; retry: () => void } {
  const [options, setOptions] = useState<OptionsState>(initial ?? { status: "loading" });
  const [attempt, setAttempt] = useState(initial ? -1 : 0);
  useEffect(() => {
    if (attempt < 0) return;
    let alive = true;
    setOptions({ status: "loading" });
    void (api ?? createOptionsApi())().then((o) => {
      if (alive) setOptions(o ? { status: "ready", options: o } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [api, attempt]);
  return { options, retry: () => setAttempt((n) => Math.max(0, n) + 1) };
}
