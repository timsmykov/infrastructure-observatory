import { mkdir, writeFile } from "node:fs/promises";
import { demoSnapshot, DEMO_HOSTS } from "../src/lib/demo";
import { dashboardSvg } from "../src/lib/render";
import { resourceSections } from "../src/lib/resource-details";
import { escapeXml } from "../src/lib/render";

const now = Date.parse("2026-11-05T12:00:00Z");
await mkdir("../demo", { recursive: true });
const cards: string[] = [];
for (const host of DEMO_HOSTS) {
  const snapshot = demoSnapshot(host, "6h", now);
  for (const theme of ["dark", "light"] as const) {
    const svg = dashboardSvg(snapshot, theme, undefined, now);
    await writeFile(`../demo/${host}-${theme}.svg`, svg);
    cards.push(`<section><h2>${host} · ${theme}</h2>${svg}</section>`);
  }
  const details = resourceSections(snapshot, now)
    .map(
      (s) =>
        `<h3>${escapeXml(s.title)}</h3><table>${s.rows.map((r) => `<tr><td>${escapeXml(r.title)}</td><td>${escapeXml(r.value)}</td><td>${escapeXml(r.subtitle || "")}</td></tr>`).join("")}</table>`,
    )
    .join("");
  cards.push(
    `<details><summary>${host} · metric details</summary>${details}</details>`,
  );
}
await writeFile(
  "../demo/index.html",
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Infrastructure Observatory · Demo</title><style>body{background:#101418;color:#edf2f5;font:16px system-ui;max-width:1060px;margin:auto;padding:32px}h1{font-size:32px}p{max-width:75ch;color:#bbc7d0;line-height:1.6}svg{width:100%;height:auto}section{margin:36px 0}summary{cursor:pointer;padding:20px 0}table{width:100%;border-collapse:collapse}td{padding:10px;border-bottom:1px solid #34404a}a{color:#8bd6c4}</style><h1>Infrastructure Observatory</h1><p>Synthetic demo data. These panels use the same SVG renderer and view model as the Raycast extension. A sample contains healthy, maintenance and unknown components, intentional gaps in history, and a stale host. This browser page previews the rendering; the native command runs in Raycast on macOS.</p>${cards.join("")}</html>`,
);
console.log(
  "Generated demo/index.html and six SVG panels. Serve the project root with python3 -m http.server 8080.",
);
