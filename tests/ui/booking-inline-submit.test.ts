// FASTSPLIT-BOOKING-INLINE-CONTINUE-001: every wizard step ends with a VISIBLE in-form submit
// (owner capture: on a short viewport the step showed no action). Same native submit of the step
// form, same STEP_ACTION label; the fixed bar's data-booking-submit stays unique for QA.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import * as draftModule from "../../components/app/booking-draft";
import { loadModule } from "../documents/harness";
import type * as Booking from "../../components/role/public-booking";

const tp = loadModule("components/app/theme-provider.tsx");
const booking = loadModule("components/role/public-booking.tsx", { "@/components/app/theme-provider": tp, "../app/booking-draft": draftModule }) as unknown as typeof Booking;
const catalog = loadModule("components/role/public-service-catalog.ts") as Record<string, any>;
const service = catalog.SERVICES[0];
const contact = { civility: "mme" as const, first_name: "Camille", last_name: "Durand", email: "camille@example.test", phone: "06 12 34 56 78", company: false };
const address = { address: "12 rue des Lilas", postal_code: "97200", city: "Fort-de-France" };
const wizard = (step: 1 | 2 | 3 | 4) =>
  renderToString(createElement(tp.ThemeProvider as never, null, createElement(booking.BookingWizard as never, { service, range: "150 € – 250 €", onClose() {}, initial: { ...booking.EMPTY_BOOKING, urgent: false, slot: "tomorrow", contact, address, step } } as never))).replaceAll("<!-- -->", "");

test("each step: one inline submit INSIDE the step form + the unique fixed-bar submit, same label", () => {
  for (const step of [1, 2, 3, 4] as const) {
    const html = wizard(step);
    const form = html.match(/<form id="([^"]+)"[\s\S]*?<\/form>/);
    assert.ok(form, `step ${step}: form`);
    const inline = [...form[0].matchAll(/<button type="submit"[^>]*data-booking-inline-submit="(\d)"[^>]*>([^<]*)<\/button>/g)];
    assert.equal(inline.length, 1, `step ${step}: exactly one inline submit inside the form`);
    assert.equal(inline[0][1], String(step));
    assert.equal(inline[0][2], booking.STEP_ACTION[step]);
    const bar = [...html.matchAll(/<button type="submit" form="([^"]+)"[^>]*data-booking-submit="(\d)"[^>]*>([^<]*)<\/button>/g)];
    assert.equal(bar.length, 1, `step ${step}: fixed bar submit still unique`);
    assert.equal(bar[0][1], form[1], "bar submits the same form");
    assert.equal(bar[0][3], booking.STEP_ACTION[step]);
    assert.equal((html.match(/data-booking-submit=/g) || []).length, 1, "QA hook stays on the bar only");
  }
});

test("CSS: 48px target, visible focus, full width on mobile, long label wraps (not clipped)", () => {
  const css = readFileSync("components/role/public-booking.module.css", "utf8");
  const block = css.slice(css.indexOf(".inlineSubmit {"));
  assert.match(block, /min-height: 48px/);
  assert.match(block, /white-space: normal/);
  assert.match(css, /\.inlineSubmit:focus-visible \{\s*outline: 3px solid var\(--ui-focus\)/);
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.inlineSubmit \{\s*width: 100%;/);
});

test("no logic change: same submit handler, no new state/API/draft code", () => {
  const src = readFileSync("components/role/public-booking.tsx", "utf8");
  assert.equal((src.match(/onSubmit=\{submit\}/g) || []).length, 1, "single form handler");
  assert.match(src, /<button type="submit" className=\{styles\.inlineSubmit\} data-booking-inline-submit=\{state\.step\}>\s*\{STEP_ACTION\[state\.step\]\}/);
});
