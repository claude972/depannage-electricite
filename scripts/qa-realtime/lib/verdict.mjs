// Conclusion table (contract §3 « Lecture de verdict »). Each line requires positive evidence; the
// absence of an event alone never proves H3. Measurements are referenced by name.
export function conclude(measurements) {
  const m = Object.fromEntries(measurements.map((x) => [x.name, x]));
  const evt = (x) => x?.verdict === "event_received";
  const sysError = (x, text) => (x?.system || []).some((s) => s.status === "error" && s.message === text);
  const roleProven = (x) => x?.auth?.verdict === "proven";
  const out = [];
  const app = m["app-4"];
  if (app?.verdict === "join_refused" && app.error_message === "mismatch between server and client bindings for postgres changes" && evt(m["pub-3"]))
    out.push({ code: "H1a", basis: "app-4 join refused (mismatch), pub-3 confirmed join + own event" });
  if (app?.verdict === "no_event" && sysError(app, "Unable to subscribe to changes with given parameters") && (evt(m["pub-3"]) || evt(m["int-1"])))
    out.push({ code: "H1b", basis: "app-4 SUBSCRIBED without event + whitelisted system error; a witness received its event" });
  for (const x of measurements) if (x.auth?.verdict === "observed_false") out.push({ code: "H2_observed", measurement: x.name, basis: "captured join/epoch token absent or not authenticated (this measurement only)" });
  const conforming = (x) => roleProven(x) && x.join?.all_match === true;
  for (const x of measurements) if (conforming(x) && (x.system || []).some((s) => s.status === "error" && s.message === "RLS")) out.push({ code: "H3", measurement: x.name, basis: "role proven, bindings match, positive whitelisted RLS error" });
  const int = m["int-1"];
  if (!out.length && conforming(int) && int.verdict === "no_event" && !(int.system || []).some((s) => s.status === "error"))
    out.push({ code: "UNKNOWN_H3_POSSIBLE", basis: "role proven, bindings match, no error, no event even on int-1 (absence alone is not H3)" });
  if (!out.length) out.push({ code: "INCONCLUSIVE", basis: "no line of the table is positively established" });
  return out;
}
