import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pwPath = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const chrome = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const skip = existsSync(path.join(pwPath, "index.mjs")) && existsSync(chrome) ? false : "Local browser unavailable (not PASS)";
const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import * as L from "leaflet";
import BookingMap from "./shared/booking-map";
import "leaflet/dist/leaflet.css";
L.Map.addInitHook(function () { window.currentMap = this; });
window.moves = [];
let root;
window.mount = () => { root = createRoot(document.getElementById("root")); root.render(React.createElement(React.StrictMode, null, React.createElement(BookingMap, {target:null,onMove:p=>window.moves.push(p)}))); };
window.unmount = () => flushSync(() => root.unmount());
window.mount();
`;
test("booking map: resize then leave the step, no delayed move callback on a removed map", { skip }, async () => {
  const bundle = await build({ absWorkingDir: root, stdin: { contents: entry, resolveDir: root, loader:"tsx" }, bundle:true, write:false, outdir:"out", platform:"browser", format:"iife", jsx:"automatic", loader:{".css":"local-css",".png":"dataurl"}, define:{"process.env.NODE_ENV":'"development"'},logLevel:"silent" });
  const js = bundle.outputFiles.find(f=>f.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find(f=>f.path.endsWith(".css"))?.text ?? "";
  const server = createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":"text/html");res.end(req.url==="/app.js"?js:`<!doctype html><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const pw = await import(pathToFileURL(path.join(pwPath,"index.mjs")).href);
  const browser = await pw.chromium.launch({executablePath:chrome,headless:true});
  try {
    for (const width of [390,1280]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      await page.route("https://tile.openstreetmap.org/**",(route: { abort(): Promise<void> })=>route.abort());
      const errors:string[]=[]; page.on("pageerror",(error: Error)=>errors.push(String(error)));
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`);
      await page.waitForFunction("Boolean(window.currentMap && document.querySelector('.leaflet-map-pane'))");
      // Leaflet's public resize invalidation schedules moveend after 200 ms. Leaving the
      // wizard before it fires used to call getCenter() on a destroyed pane.
      await page.evaluate(`document.getElementById('root').style.width = '300px'; window.currentMap.invalidateSize({debounceMoveend:true}); window.unmount()`);
      await page.waitForTimeout(350);
      assert.deepEqual(errors,[], "navigation after resize must not raise a page error");
      assert.equal(await page.evaluate("window.moves.length"),0,"no stale address callback");
      await page.evaluate("window.mount()");
      await page.waitForFunction("Boolean(document.querySelector('.leaflet-map-pane'))");
      await page.evaluate("window.currentMap.panBy([20,0],{animate:false})");
      assert.ok(await page.evaluate("window.moves.length > 0"),"fresh map still moves");
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
});
