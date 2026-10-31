import { test } from "node:test";
import assert from "node:assert/strict";
import { apiResponseMatches } from "../lib/browser.mjs";

const route = "/api/interventions/abc/quote-draft";
const info = (over = {}) => ({ url: `http://localhost:3017${route}`, method: "POST", status: 200, ...over });

test("apiResponseMatches: exact pathname + method, optional exact status and query substring (QA-QUOTE-001)", () => {
  assert.equal(apiResponseMatches(info(), { pathname: route, method: "POST", status: 200 }), true);
  assert.equal(apiResponseMatches(info(), { pathname: route, method: "POST" }), true, "status optional");
  assert.equal(apiResponseMatches(info({ status: 409 }), { pathname: route, method: "POST", status: 200 }), false, "the 409 of the stale save is not the 200 of the keep-mine save");
  assert.equal(apiResponseMatches(info({ status: 409 }), { pathname: route, method: "POST", status: 409 }), true);
  assert.equal(apiResponseMatches(info({ method: "GET" }), { pathname: route, method: "POST", status: 200 }), false, "a follow-up GET never satisfies the POST wait");
  assert.equal(apiResponseMatches(info({ method: "post" }), { pathname: route, method: "POST" }), true, "method case-insensitive");
  assert.equal(apiResponseMatches(info({ url: `http://localhost:3017${route}/extra` }), { pathname: route, method: "POST" }), false, "exact path only");
  assert.equal(apiResponseMatches(info({ url: "http://localhost:3017/api/workspace" }), { pathname: route, method: "POST" }), false);
  assert.equal(apiResponseMatches(info({ url: "http://localhost:3017/api/admin/interventions?cursor=xyz&limit=100" }), { pathname: "/api/admin/interventions", method: "GET", query: "cursor=" }), false, "method GET expected but info is POST");
  assert.equal(apiResponseMatches(info({ url: "http://localhost:3017/api/admin/interventions?cursor=xyz&limit=100", method: "GET" }), { pathname: "/api/admin/interventions", method: "GET", query: "cursor=" }), true);
  assert.equal(apiResponseMatches(info({ url: "http://localhost:3017/api/admin/interventions?limit=100", method: "GET" }), { pathname: "/api/admin/interventions", method: "GET", query: "cursor=" }), false, "query substring required");
  assert.equal(apiResponseMatches({ url: "not a url", method: "POST", status: 200 }, { pathname: route, method: "POST" }), false);
});
