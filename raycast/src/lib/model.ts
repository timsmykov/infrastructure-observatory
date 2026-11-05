import { WINDOWS_RESOURCE_GROUPS } from "./windows";
import { RESOURCE_GROUPS } from "./catalog";
export type Point = [number, number | null];
export type Series = { labels: Record<string, string>; points: Point[] };
export type QueryResult = { series: Series[]; error?: string };
type Field = { type: string; labels?: Record<string, string> };
type Frame = { schema?: { fields?: Field[] }; data?: { values?: unknown[][] } };
export type Health =
  "healthy" | "warning" | "critical" | "unknown" | "maintenance";
export type Layer = { status: Health; text: string };
export type Component = {
  id: string;
  name: string;
  kind: string;
  state: string;
  owner: string;
};
export type Snapshot = {
  host: string;
  period: "1h" | "6h" | "24h";
  fetchedAt: number;
  latency: number;
  results: Record<string, QueryResult>;
};

export function parseResults(
  input: unknown,
  refs: string[],
): Record<string, QueryResult> {
  if (
    !input ||
    typeof input !== "object" ||
    !("results" in input) ||
    !input.results ||
    typeof input.results !== "object"
  )
    throw new Error("Invalid Grafana response");
  const results = input.results as Record<
    string,
    { status?: number; error?: string; frames?: Frame[] }
  >;
  return Object.fromEntries(
    refs.map((ref) => {
      const r = results[ref];
      if (!r)
        return [ref, { series: [], error: "Query missing from response" }];
      if (r.error || (r.status && r.status >= 400))
        return [ref, { series: [], error: "Source returned a query error" }];
      const series: Series[] = [];
      let malformed = false;
      for (const frame of r.frames ?? []) {
        const fields = frame.schema?.fields ?? [];
        const values = frame.data?.values ?? [];
        // Grafana represents a successful empty vector as an empty frame.
        if (!fields.length && !values.length) continue;
        const timeIndex = fields.findIndex((f) => f.type === "time");
        if (timeIndex < 0) {
          malformed = true;
          continue;
        }
        for (let i = 0; i < fields.length; i++) {
          if (fields[i].type !== "number") continue;
          const times = values[timeIndex] ?? [];
          const nums = values[i] ?? [];
          const points: Point[] = [];
          for (let j = 0; j < times.length; j++) {
            if (typeof times[j] !== "number" || !Number.isFinite(times[j]))
              continue;
            const v = nums[j];
            points.push([
              times[j] as number,
              typeof v === "number" && Number.isFinite(v) ? v : null,
            ]);
          }
          series.push({
            labels: fields[i].labels ?? {},
            points: points.sort((a, b) => a[0] - b[0]),
          });
        }
      }
      return [
        ref,
        { series, ...(malformed ? { error: "Invalid data frame" } : {}) },
      ];
    }),
  );
}

// The final sample must itself be valid. An old value before a trailing gap is not current.
export function latest(series: Series | undefined): number | undefined {
  const v = series?.points.at(-1)?.[1];
  return v === null ? undefined : v;
}
export function value(s: Snapshot, key: string): number | undefined {
  return latest(s.results[key]?.series[0]);
}
export function rows(s: Snapshot, key: string): Series[] {
  return s.results[key]?.series ?? [];
}
export function components(s: Snapshot): Component[] {
  return rows(s, "components")
    .filter((r) => latest(r) === 1)
    .map((r) => ({
      id: r.labels.id || r.labels.name,
      name: r.labels.name || r.labels.id || "Unnamed",
      kind: r.labels.kind || "component",
      state: r.labels.state || "unknown",
      owner: r.labels.owner || "",
    }));
}
export function counts(s: Snapshot): Record<string, number> {
  const c: Record<string, number> = {};
  for (const component of components(s))
    c[component.state] = (c[component.state] || 0) + 1;
  return c;
}
export function age(
  s: Snapshot,
  key: string,
  now = Date.now(),
): number | undefined {
  const time = value(s, key);
  return time === undefined ? undefined : Math.max(0, now / 1000 - time);
}
export function observationStale(
  s: Snapshot,
  key: string,
  now = Date.now(),
): boolean {
  const seconds = age(s, key, now);
  return seconds === undefined || seconds > 180 || now - s.fetchedAt > 90000;
}
export function targetCounts(s: Snapshot, layer?: "foundation" | "services") {
  const all = rows(s, "targets").filter(
    (r) =>
      !layer ||
      (layer === "foundation"
        ? r.labels.job?.startsWith("foundation-")
        : r.labels.layer === "services" ||
          r.labels.job?.startsWith("services-")),
  );
  const paused = all.filter(
    (r) =>
      r.labels.job === "foundation-central" &&
      r.labels.instance === "127.0.0.1:3274" &&
      value(s, "notificationsPaused") === 1,
  );
  const active = all.filter((r) => !paused.includes(r));
  const observed = active.filter((r) => latest(r) !== undefined);
  return {
    up: observed.filter((r) => latest(r) === 1).length,
    total: active.length,
    down: observed.filter((r) => latest(r) === 0).length,
    unknown: active.length - observed.length,
    paused: paused.length,
  };
}
export function isWindows(s: Snapshot): boolean {
  return rows(s, "platform").some((r) => r.labels.os === "windows");
}
export function coverage(s: Snapshot) {
  const expected: readonly string[] = isWindows(s)
    ? WINDOWS_RESOURCE_GROUPS
    : RESOURCE_GROUPS;
  const observed = new Map(
    rows(s, "coverage").map((r) => [r.labels.group, latest(r)]),
  );
  const missing = expected.filter((g) => observed.get(g) !== 1);
  return {
    present: expected.length - missing.length,
    total: expected.length,
    missing,
  };
}
export function layers(
  s: Snapshot,
  now = Date.now(),
): { foundation: Layer; services: Layer } {
  const c = counts(s);
  const ft = targetCounts(s, "foundation");
  const st = targetCounts(s, "services");
  const foundationAlerts = [
    ...rows(s, "alerts"),
    ...rows(s, "globalAlerts"),
  ].filter((a) => a.labels.layer === "foundation" && latest(a) === 1);
  const required = [
    "cpu",
    "ram",
    "disk",
    "cpuPressure",
    "ioPressure",
    "rx",
    "tx",
    "swapUsed",
    "swapTotal",
    "swapIn",
    "targets",
    "sourceTime",
    "alerts",
    "globalAlerts",
    "coverage",
    "profileTime",
    "profileSuccess",
    "sourceAvailable",
    "sourceRequired",
    "collectors",
    "notificationsPaused",
  ];
  const notApplicable = isWindows(s)
    ? new Set(["cpuPressure", "ioPressure"])
    : new Set<string>();
  const missing = required.filter(
    (key) =>
      !notApplicable.has(key) &&
      (s.results[key]?.error ||
        (!rows(s, key).length && !["alerts", "globalAlerts"].includes(key)) ||
        (rows(s, key).length > 0 && latest(rows(s, key)[0]) === undefined)),
  );
  const resourceConditions = rows(s, "conditions").filter(
    (r) => latest(r) === 1,
  );
  const cov = coverage(s);
  const sourceRequired = new Map(
    rows(s, "sourceRequired").map((r) => [r.labels.source, latest(r)]),
  );
  const sourceAvailable = new Map(
    rows(s, "sourceAvailable").map((r) => [r.labels.source, latest(r)]),
  );
  const centralMissing = ["prometheus", "alertmanager", "bridge"].filter(
    (source) =>
      sourceRequired.get(source) !== 0 &&
      (sourceRequired.get(source) !== 1 || sourceAvailable.get(source) !== 1),
  );
  let foundation: Layer;
  if (observationStale(s, "sourceTime", now))
    foundation = { status: "unknown", text: "No fresh host observation" };
  else if (
    observationStale(s, "profileTime", now) ||
    value(s, "profileSuccess") !== 1 ||
    cov.missing.length ||
    missing.length ||
    rows(s, "collectors").some((r) => latest(r) !== 1)
  )
    foundation = {
      status: "unknown",
      text: `Coverage ${cov.present}/${cov.total} · data is missing`,
    };
  else if (
    foundationAlerts.some((r) => r.labels.severity === "critical") ||
    resourceConditions.some((r) => r.labels.severity === "critical")
  )
    foundation = {
      status: "critical",
      text: `${foundationAlerts.length + resourceConditions.length} conditions need attention`,
    };
  else if (
    ft.down ||
    ft.unknown ||
    centralMissing.length ||
    foundationAlerts.some((r) => r.labels.severity === "warning") ||
    resourceConditions.length
  )
    foundation = {
      status: "warning",
      text: ft.down
        ? `${ft.up}/${ft.total} sources · some unavailable`
        : centralMissing.length
          ? "Required sources are unavailable"
          : `${foundationAlerts.length + resourceConditions.length} warnings`,
    };
  else
    foundation = {
      status: "healthy",
      text: `${cov.present}/${cov.total} groups · ${ft.up}/${ft.total} sources${ft.paused ? ` · ${ft.paused} paused` : ""}`,
    };
  const serviceErrors = [
    "components",
    "collection",
    "targets",
    "probes",
    "postgres",
    "redis",
    "jobs",
    "alerts",
  ].some((k) => s.results[k]?.error);
  const paused = new Set(
    components(s)
      .filter((c) => c.state === "maintenance")
      .map((c) => c.id),
  );
  const failedProbes = ["probes", "postgres", "redis"]
    .flatMap((k) => rows(s, k))
    .filter(
      (r) => latest(r) === 0 && !paused.has(r.labels.component_id),
    ).length;
  const serviceAlerts = rows(s, "alerts").filter(
    (a) => a.labels.layer === "services" && latest(a) === 1,
  );
  let services: Layer;
  if (
    observationStale(s, "collection", now) ||
    !components(s).length ||
    serviceErrors
  )
    services = {
      status: "unknown",
      text: "Incomplete or stale service observation",
    };
  else if (
    c.unhealthy ||
    failedProbes ||
    serviceAlerts.some((a) => a.labels.severity === "critical")
  )
    services = {
      status: "critical",
      text: `Unhealthy components: ${c.unhealthy || 0}${failedProbes ? ` · failed probes: ${failedProbes}` : ""}`,
    };
  else if (c.unknown || st.down || st.unknown || serviceAlerts.length)
    services = {
      status: "warning",
      text: `${c.unknown || 0} unknown · ${st.down} sources unavailable`,
    };
  else if (c.maintenance)
    services = {
      status: "maintenance",
      text: `${c.healthy || 0} healthy · ${c.maintenance} maintenance`,
    };
  else
    services = {
      status: "healthy",
      text: `${c.healthy || 0} healthy components`,
    };
  return { foundation, services };
}

export function bytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "No data";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString("en-GB", { maximumFractionDigits: i > 1 ? 1 : 0 })} ${units[i]}`;
}
export function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "No data";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
}
export function percent(n: number | undefined): string {
  return n === undefined ? "—" : `${n.toFixed(1)}%`;
}
export function chartGaps(points: Point[], expectedStepMs: number): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    if (
      point[1] === null ||
      (current.length && point[0] - current.at(-1)![0] > expectedStepMs * 2.5)
    ) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (point[1] !== null) current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}
