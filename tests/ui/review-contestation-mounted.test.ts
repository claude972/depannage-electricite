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
import { ReviewContestationPanel } from "./components/features/review-contestation/review-contestation-panel";
const id = n => "50000000-0000-4000-8000-"+String(n).padStart(12,"0");
window.state = { user: id(1), generation:1, readFail:true, posts:[], saved:null, loseReply:true, hold:false };
const s=window.state;
window.fetch=async (url, init={})=>{
 if (init.method === "POST") {
  const command=JSON.parse(init.body); s.posts.push(command);
  if (s.hold) await new Promise(r=>s.release=r);
  s.saved ||= {id:id(3),review_id:id(2),request_id:command.request_id,reason:command.reason,status:"open",created_at:"2026-11-19T12:00:00Z",decided_at:null,decision_note:""};
  if(s.loseReply){s.loseReply=false;return Response.json({error:"Connexion interrompue."},{status:503});}
  return Response.json({contestation:s.saved,replayed:true});
 }
 if(s.readFail)return Response.json({error:"Lecture indisponible."},{status:503});
 return Response.json({review:{id:id(2),intervention_id:id(4),rating:2,body:"Avis synthétique."},contestations:s.saved?[s.saved]:[],limited:false});
};
const r=createRoot(document.getElementById("root"));
window.render=()=>r.render(React.createElement(React.StrictMode,null,React.createElement(ReviewContestationPanel,{reviewId:id(2),context:{userId:()=>s.user,generation:()=>s.generation}})));
window.render();
`;
test("artisan review: read failure, validation, uncertain send replay, double submit and identity fencing", { skip }, async () => {
 const bundle=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},logLevel:"silent"});
 const js=bundle.outputFiles[0].text;
 const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/app.js"?"text/javascript":"text/html");res.end(req.url==="/app.js"?js:'<!doctype html><style>textarea{display:block;width:90%;}button{margin:8px;}</style><div id="root"></div><script src="/app.js"></script>');});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const pw=await import(pathToFileURL(path.join(pwPath,"index.mjs")).href);
 const browser=await pw.chromium.launch({executablePath:chrome,headless:true});
 try {
  for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:1000}});const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(String(e)));
   await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`);
   await page.getByText("Lecture indisponible.",{exact:true}).waitFor();
   await page.evaluate("window.state.readFail=false");await page.getByRole("button",{name:"Recharger l’avis",exact:true}).click();
   await page.getByRole("button",{name:"Contester cet avis",exact:true}).click();
   await page.getByText("Expliquez votre contestation en 10 à 2 000 caractères.",{exact:true}).waitFor();
   assert.equal(await page.evaluate("window.state.posts.length"),0);
   await page.getByLabel("Motif de la contestation",{exact:true}).fill("La prestation décrite ne correspond pas à ce dossier synthétique.");
   await page.getByRole("button",{name:"Contester cet avis",exact:true}).click();
   await page.getByRole("button",{name:"Vérifier et reprendre l’envoi",exact:true}).waitFor();
   assert.equal(await page.getByLabel("Motif de la contestation",{exact:true}).isDisabled(),true);
   await page.evaluate("window.state.hold=true;document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit()");
   await page.waitForFunction("window.state.posts.length===2");
   await page.evaluate("window.state.release()");
   await page.getByText("Votre contestation a été enregistrée. Elle sera examinée par la plateforme.",{exact:true}).waitFor();
   assert.equal(await page.evaluate("window.state.posts[0].request_id===window.state.posts[1].request_id"),true);
   assert.equal(await page.getByText("Contestation ouverte",{exact:true}).count(),1);
   await page.evaluate("window.state.saved.status='dismissed';window.state.saved.decision_note='Décision synthétique motivée.'");
   await page.getByRole("button",{name:"Actualiser la décision",exact:true}).click();
   await page.getByText("Décision : Décision synthétique motivée.",{exact:true}).waitFor();
   await page.getByLabel("Motif de la contestation",{exact:true}).fill("Autre motif synthétique suffisamment détaillé.");
   await page.getByRole("button",{name:"Contester cet avis",exact:true}).click();
   await page.waitForFunction("window.state.posts.length===3");
   await page.evaluate("window.state.user=null;window.state.generation++;window.render();window.state.release()");
   await page.waitForTimeout(100);
   assert.equal(await page.getByText("Votre contestation a été enregistrée. Elle sera examinée par la plateforme.",{exact:true}).count(),0);
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate("document.documentElement.scrollWidth<=innerWidth"));await page.close();
  }
 }finally{await browser.close();server.close();}
});
