import test from "node:test";
import assert from "node:assert/strict";
import {withApp,skip} from "./real-app-harness";

test("retour de confirmation : l’explication survit à la navigation et le paramètre URL ne prouve aucune confirmation", {skip}, async()=>{
 await withApp(async open=>{
  const {page,errors,api}=await open("client-home",390);
  const base=new URL(page.url()).origin;
  await page.goto(base+'/?auth=expired');
  await page.getByText("Ce lien de confirmation est expiré ou déjà utilisé. Demandez un nouveau lien depuis la connexion.",{exact:true}).waitFor({timeout:3000});
  assert.equal(new URL(page.url()).hash,"#auth");
  await page.goto(base+'/?auth=confirmed');
  await page.getByText("Connectez-vous pour vérifier votre compte et ouvrir votre espace.",{exact:true}).waitFor({timeout:3000});
  assert.doesNotMatch(await page.locator("body").innerText(),/Votre adresse est confirmée/);
  assert.equal(new URL(page.url()).hash,"#auth");
  await page.goto(base+'/?payment=pending&intervention=00000000-0000-4000-8000-000000000001');
  await page.getByText("Connectez-vous pour relire l’état de votre retour Stripe. Aucun statut n’est déduit du lien.",{exact:true}).waitFor({timeout:3000});
  assert.equal(new URL(page.url()).hash,"#auth");
  assert.deepEqual(api.filter((call: string) => !call.startsWith("GET ")),[],"aucune création de demande ni action serveur au retour");
  assert.deepEqual(errors,[]);
 });
});
