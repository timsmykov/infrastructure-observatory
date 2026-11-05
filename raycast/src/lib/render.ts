import { PERIODS } from "./catalog";
import {
  age,
  bytes,
  chartGaps,
  counts,
  duration,
  layers,
  isWindows,
  latest,
  percent,
  rows,
  targetCounts,
  value,
  type Health,
  type Snapshot,
} from "./model";

export const WIDTH = 1000;
export const HEIGHT = 460;
const palettes = {
  dark: {
    bg: "#171a1e",
    panel: "#20252a",
    rule: "#343b42",
    text: "#f0f3f5",
    secondary: "#b9c1c9",
    muted: "#83909c",
    blue: "#91b4de",
    mint: "#75cdbb",
    neutral: "#b1b9d6",
  },
  light: {
    bg: "#f5f6f7",
    panel: "#ffffff",
    rule: "#d5dce1",
    text: "#18252d",
    secondary: "#425565",
    muted: "#637582",
    blue: "#426c9a",
    mint: "#267a6b",
    neutral: "#676491",
  },
};
const darkStateColors: Record<Health, string> = {
  healthy: "#62bba4",
  warning: "#dca75c",
  critical: "#e4858e",
  unknown: "#97a4af",
  maintenance: "#aaa0d0",
};
export function escapeXml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
export function dashboardSvg(
  s: Snapshot,
  theme: "dark" | "light",
  error?: string,
  now = Date.now(),
): string {
  const stateColors: Record<Health, string> =
    theme === "dark"
      ? darkStateColors
      : {
          healthy: "#267a65",
          warning: "#946016",
          critical: "#b54355",
          unknown: "#5d6c79",
          maintenance: "#7061a0",
        };
  const p = palettes[theme],
    l = layers(s, now),
    c = counts(s),
    t = targetCounts(s);
  const offline = !!error || now - s.fetchedAt > 90000;
  const text = (
    x: number,
    y: number,
    str: string,
    size = 14,
    color = p.text,
    weight = 400,
    tracking = 0,
  ) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}">${escapeXml(str)}</text>`;
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color = p.rule,
  ) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1"/>`;
  const tag = (x: number, y: number, label: string, color: string) =>
    `<rect x="${x}" y="${y - 14}" width="${label.length * 7 + 19}" height="21" rx="5" fill="${color}" fill-opacity=".11"/>${text(x + 9, y, label, 11, color, 650, 0.4)}`;
  const layer = (x: number, title: string, status: Health, detail: string) => {
    const color = stateColors[status],
      label = {
        healthy: "HEALTHY",
        warning: "WARNING",
        critical: "CRITICAL",
        unknown: "UNKNOWN",
        maintenance: "MAINTENANCE",
      }[status];
    return `<rect x="${x}" y="82" width="468" height="60" rx="9" fill="${p.panel}" stroke="${p.rule}" stroke-width=".7"/><path d="M${x + 1} 94v36" stroke="${color}" stroke-width="2"/>${text(x + 17, 105, title, 14, p.text, 600)}${text(x + 17, 126, truncate(detail, 48), 12, p.secondary)}${tag(x + 340, 105, label, color)}`;
  };
  const graph = (
    keys: string[],
    x: number,
    y: number,
    w: number,
    h: number,
    max: number,
    colors: string[],
    id: string,
  ) => {
    const end = s.fetchedAt,
      span = PERIODS[s.period] * 1000;
    let out = line(x, y + h, x + w, y + h);
    let observed = false;
    keys.forEach((key, i) => {
      for (const series of rows(s, key))
        for (const segment of chartGaps(
          series.points,
          Math.ceil(PERIODS[s.period] / 100) * 1000,
        )) {
          const ps = segment
            .filter(([time]) => time >= end - span && time <= end + 1000)
            .map(([time, v]) => [
              x + Math.max(0, Math.min(1, (time - (end - span)) / span)) * w,
              y + h - Math.max(0, Math.min(1, (v ?? 0) / max)) * h,
            ]);
          if (!ps.length) continue;
          observed = true;
          const points = ps.map((q) => q.join(",")).join(" ");
          out += `<defs><linearGradient id="${id}-${i}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${colors[i]}" stop-opacity=".18"/><stop offset="1" stop-color="${colors[i]}" stop-opacity="0"/></linearGradient></defs><polygon points="${ps[0][0]},${y + h} ${points} ${ps.at(-1)![0]},${y + h}" fill="url(#${id}-${i})"/><polyline points="${points}" fill="none" stroke="${colors[i]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
        }
    });
    return (
      out +
      (observed
        ? ""
        : text(x, y + h / 2 + 5, "No time series available", 12, p.muted))
    );
  };
  const metric = (
    x: number,
    title: string,
    key: string,
    history: string,
    subtitle: string,
    color: string,
  ) => {
    const v = value(s, key),
      label = percent(v),
      bounded = v === undefined ? 0 : Math.max(0, Math.min(100, v));
    return `${text(x, 174, title, 11, p.muted, 650, 1.3)}${text(x, 215, label, 38, p.text, 500, -1.4)}${text(x, 238, subtitle, 12, p.secondary)}<rect x="${x}" y="250" width="210" height="2" rx="1" fill="${p.rule}"/><rect x="${x}" y="250" width="${2.1 * bounded}" height="2" rx="1" fill="${color}"/>${graph([history], x, 267, 210, 31, 100, [color], history)}`;
  };
  const rx = value(s, "rx"),
    tx = value(s, "tx");
  const netMax = Math.max(
    1024,
    ...["rxHistory", "txHistory"].flatMap((k) =>
      rows(s, k).flatMap((r) => r.points.map((q) => q[1] ?? 0)),
    ),
  );
  const signals = [
    ...rows(s, "alerts"),
    ...rows(s, "globalAlerts"),
    ...rows(s, "conditions"),
  ]
    .filter((r) => latest(r) === 1)
    .sort(
      (a, b) =>
        (a.labels.severity === "critical" ? 0 : 1) -
        (b.labels.severity === "critical" ? 0 : 1),
    );
  const signalLine = (index: number) => {
    const r = signals[index];
    if (!r)
      return index === 0
        ? text(545, 374, "No active signals in available data", 13, p.secondary)
        : "";
    const label =
      r.labels.name || r.labels.alertname || r.labels.condition || "Signal";
    return `<circle cx="551" cy="${369 + index * 23}" r="3" fill="${r.labels.severity === "critical" ? stateColors.critical : stateColors.warning}"/>${text(563, 374 + index * 23, truncate(label, 48), 13, p.secondary)}`;
  };
  const stamp = new Date(s.fetchedAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
  const title = error
    ? "OFFLINE · LAST SNAPSHOT"
    : offline
      ? "LAST SNAPSHOT · AWAITING REFRESH"
      : s.host.startsWith("demo-")
        ? "INFRASTRUCTURE / SYNTHETIC DEMO"
        : "INFRASTRUCTURE / OVERVIEW";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 1000 460"><rect width="1000" height="460" rx="14" fill="${p.bg}"/><g font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" style="font-variant-numeric:tabular-nums">${text(24, 25, title, 10, offline ? stateColors.warning : p.muted, 600, 1.5)}${text(24, 60, s.host, 29, p.text, 600, -0.8)}<circle cx="759" cy="24" r="3" fill="${offline ? stateColors.warning : p.mint}"/>${text(771, 28, error ? "REFRESH UNAVAILABLE" : offline ? "AWAITING REFRESH" : "VIA GRAFANA · " + s.period, 11, p.secondary, 500, 0.5)}${text(756, 56, `${stamp} UTC · ${duration(age(s, "sourceTime", now))} ago`, 12, p.muted)}${layer(24, "Host Resources", offline ? "unknown" : l.foundation.status, offline ? "No fresh response from Grafana" : l.foundation.text)}${layer(508, "Services and Applications", offline ? "unknown" : l.services.status, offline ? "States from the last snapshot" : l.services.text)}${metric(24, "CPU", "cpu", "cpuHistory", isWindows(s) ? `CPU Queue: ${value(s, "cpuQueue") ?? "no data"}` : `Pressure ${percent(value(s, "cpuPressure"))}`, p.blue)}${metric(270, "RAM", "ram", "ramHistory", `${bytes(value(s, "ramAvailable"))} available`, p.mint)}${metric(516, isWindows(s) ? "DISK C:" : "DISK /", "disk", "diskHistory", `${bytes(value(s, "diskAvailable"))} free`, p.neutral)}${line(248, 165, 248, 301)}${line(494, 165, 494, 301)}${line(740, 165, 740, 301)}${text(762, 174, "NETWORK · UPLINK", 11, p.muted, 650, 1.3)}${text(762, 211, rx === undefined ? "—" : bytes(rx) + "/s", 28, p.text, 500, -0.7)}${text(762, 236, tx === undefined ? "TX · no data" : "↑ TX  " + bytes(tx) + "/s", 12, p.secondary)}${text(762, 254, "↓ RX", 10, p.blue, 500)}${graph(["rxHistory", "txHistory"], 762, 267, 210, 31, netMax, [p.blue, p.mint], "network")}${text(24, 315, `HISTORY / ${s.period.toUpperCase()}`, 9, p.muted, 500, 1)}${text(884, 315, "NOW", 9, p.muted, 500, 1)}${line(24, 328, 976, 328)}${text(24, 350, "OBSERVATION QUALITY", 10, p.muted, 650, 1.1)}${text(24, 383, `${t.up}/${t.total}`, 25, t.down ? stateColors.warning : p.text, 500, -0.5)}${text(24, 404, t.paused ? `sources · ${t.paused} paused` : "sources available", 11, p.secondary)}${text(210, 383, String(c.unknown || 0), 25, c.unknown ? stateColors.warning : p.text, 500)}${text(210, 404, "unknown", 11, p.secondary)}${text(365, 383, String(c.maintenance || 0), 25, p.neutral, 500)}${text(365, 404, "maintenance", 11, p.secondary)}${line(517, 347, 517, 407)}${text(545, 350, `ACTIVE SIGNALS  /  ${signals.length}`, 10, p.muted, 650, 1.1)}${signalLine(0)}${signalLine(1)}${line(24, 422, 976, 422)}${text(24, 445, `Services: ${duration(age(s, "collection", now))} ago · ${s.latency} ms`, 11, p.muted)}${text(624, 445, "⌘⇧H host    ⌘T period    ⌘L details", 11, p.muted)}</g></svg>`;
}
export function imageMarkdown(svg: string, key: string): string {
  return `![Infrastructure ${key}](data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}?raycast-width=${WIDTH}&raycast-height=${HEIGHT})`;
}
