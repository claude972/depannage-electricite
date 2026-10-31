// Contract §5 `captures`: demo deep links at 360 and 1280 px for human comparison with M35 /
// M43 / M66. The script only checks for horizontal overflow and the expected landmarks.
import { newPage, openHash, capture, expectVisible, noHorizontalOverflow } from "../lib/browser.mjs";

const TARGETS = [
  { name: "artisan-overview", hash: "demo/artisan", mock: "M35", landmark: (page) => page.getByRole("heading", { name: "Missions d’aujourd’hui", exact: true }) },
  { name: "admin-dashboard", hash: "demo/admin", mock: "M43", landmark: (page) => page.getByRole("heading", { name: /Tableau de bord/ }) },
  { name: "enterprise-table", hash: "demo/manager-requests", mock: "M66", landmark: (page) => page.getByRole("search", { name: "Filtres des interventions" }) },
];
const WIDTHS = [360, 1280];

export const suite = {
  name: "captures",
  description: "360/1280 captures of artisan overview (M35), admin dashboard (M43), enterprise table (M66) from the local demo",
  needsCredentials: false,
  plan: ["no fixtures: local demonstration mode"],
  async run(ctx) {
    const { base, browser, out, report, redactor } = ctx;
    for (const target of TARGETS)
      for (const width of WIDTHS)
        await report.scenario(suite.name, `${target.name} at ${width}px (${target.mock})`, async (s) => {
          const h = await newPage(browser, { baseUrl: base, width, height: width < 600 ? 780 : 900, redactor });
          try {
            await s.step("open the demo deep link", async () => {
              await openHash(h.page, base, target.hash);
              await expectVisible(target.landmark(h.page), `${target.name} landmark`);
            });
            await s.step("no horizontal overflow", () => noHorizontalOverflow(h.page, width));
            await s.step("capture", async () => {
              await capture(h, out, `${target.name}-${width}`, s);
              return { mock: target.mock, width, hash: target.hash };
            });
            s.note(`Human comparison with ${target.mock}; the script does not judge visual fidelity.`);
          } finally {
            await h.close();
          }
        });
  },
};
