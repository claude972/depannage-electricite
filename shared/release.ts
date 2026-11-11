// Version affichée par le Web et le mobile. Fichier sans import ni dépendance : Next (Turbopack et
// webpack) et Metro le lisent tel quel.
// tests/release-contract.test.ts échoue si package.json, apps/mobile/package.json ou
// apps/mobile/app.json (version, ios.buildNumber, android.versionCode) s’en écartent.
// Les compteurs de build sont locaux (eas.json : appVersionSource « local ») : les augmenter ici et
// dans app.json avant chaque build remis à un testeur ; ils ne redescendent jamais.
export const RELEASE = {
  version: "0.1.0",
  build: { ios: 10, android: 10 },
} as const;

export type BuildPlatform = keyof typeof RELEASE.build;

/** « Version 0.1.0 » sur le Web, « Version 0.1.0 (build 10) » sur une plateforme native. */
export function releaseLabel(platform?: string | null): string {
  const build = platform === "ios" || platform === "android" ? RELEASE.build[platform] : null;
  return build === null ? `Version ${RELEASE.version}` : `Version ${RELEASE.version} (build ${build})`;
}
