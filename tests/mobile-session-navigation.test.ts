import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spaceTabs } from '../apps/mobile/src/lib/mobile-navigation';

// Écart Android du 15/11 : barre invitée observée après connexion. Cause établie : l'émulateur
// exécutait une build antérieure à bd48db0d (titre « Activité » sur la liste du particulier).
// Ces garde-fous figent le contrat de la source actuelle pour que l'écart ne puisse pas revenir.
const chrome = readFileSync(new URL('../apps/mobile/src/components/global-mobile-chrome.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../apps/mobile/src/app/_layout.tsx', import.meta.url), 'utf8');
const guestLabels = ['Accueil', 'Services', 'Activité', 'Compte'];

test('connected tabs never reuse the guest menu, even before the workspace role is loaded', () => {
  for (const role of [undefined, 'client', 'artisan', 'manager', 'admin'] as const) {
    const tabs: readonly string[] = spaceTabs(role);
    assert.ok(tabs.includes('profil'), `profil manquant pour ${role}`);
    assert.ok(!tabs.includes('compte') && !tabs.includes('retrouver') && !tabs.includes('catalogue'), `onglet invité pour ${role}`);
  }
});

test('the persistent chrome derives its tabs from the live session, not from the route', () => {
  assert.match(chrome, /const items=auth\.session\?spaceTabs\(role\)/);
  assert.match(chrome, /:guest\.map\(/);
  assert.match(chrome, /if\(typing\|\|!auth\.ready\)return null;/);
  for (const label of guestLabels) assert.match(chrome, new RegExp(`label:'${label}'`));
  // Le titre de la liste particulier connecté n'est plus « Activité » : capture = build périmée.
  const list = readFileSync(new URL('../apps/mobile/src/app/(espace)/interventions.tsx', import.meta.url), 'utf8');
  assert.match(list, /'Mes demandes'/);
});

test('signing in remounts the stack and swaps guest screens for the connected space', () => {
  assert.match(layout, /<Stack key=\{session\?\.user\.id\?\?'guest'\}/);
  assert.match(layout, /<Stack\.Protected guard=\{!session\}>[\s\S]*name="compte"[\s\S]*<\/Stack\.Protected>/);
  assert.match(layout, /<Stack\.Protected guard=\{Boolean\(session\)\}>[\s\S]*name="\(espace\)"/);
  assert.ok(layout.indexOf('<GlobalMobileChrome/>') > layout.indexOf('</Stack>'), 'le menu doit rester hors de la pile, sous le même SessionProvider');
});
