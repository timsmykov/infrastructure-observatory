import { catalog, PERIODS, RESOURCE_GROUPS, type Period } from "./catalog";
import { WINDOWS_RESOURCE_GROUPS } from "./windows";
import type { QueryResult, Series, Snapshot } from "./model";

export const DEMO_HOSTS = ["demo-linux", "demo-windows", "demo-stale"];
export function demoSnapshot(
  host = "demo-linux",
  period: Period = "1h",
  now = Date.now(),
): Snapshot {
  if (!DEMO_HOSTS.includes(host)) throw new Error("Unknown demo host");
  const windows = host === "demo-windows";
  const stale = host === "demo-stale";
  const observed = now - (stale ? 600_000 : 20_000);
  const series = (
    value: number,
    labels: Record<string, string> = {},
  ): Series => ({ labels, points: [[observed, value]] });
  const results: Record<string, QueryResult> = Object.fromEntries(
    catalog(host).map((q) => [q.refId, { series: [] }]),
  );
  const values: Record<string, number> = {
    cpu: 31.4,
    ram: 58.2,
    disk: 43.7,
    rx: 340_000,
    tx: 92_000,
    ramAvailable: 7.8 * 1024 ** 3,
    ramTotal: 18.7 * 1024 ** 3,
    diskAvailable: 112.6 * 1024 ** 3,
    diskTotal: 200 * 1024 ** 3,
    swapUsed: 128 * 1024 ** 2,
    swapTotal: 2 * 1024 ** 3,
    swapIn: 0,
    cpuPressure: 0.4,
    ioPressure: 0.1,
    cores: 8,
    load1: 1.2,
    load5: 1.1,
    load15: 0.9,
    profileSuccess: 1,
    notificationsPaused: 1,
    cpuQueue: 1,
    sourceTime: observed / 1000,
    collection: observed / 1000,
    profileTime: observed / 1000,
    uptime: 264_000,
    clockSync: 1,
    clockOffset: 0.001,
    conntrack: 240,
    conntrackLimit: 262144,
    historyOldest: now / 1000 - 3 * 86400,
    historyTime: observed / 1000,
    historyPolicy: 7 * 86400,
    historyBytes: 180 * 1024 ** 2,
    historyLimit: 1024 ** 3,
  };
  for (const [key, value] of Object.entries(values))
    results[key] = { series: [series(value)] };
  results.coverage = {
    series: (windows ? WINDOWS_RESOURCE_GROUPS : RESOURCE_GROUPS).map((group) =>
      series(1, { group }),
    ),
  };
  results.collectors = {
    series: [
      series(1, { collector: "cpu" }),
      series(1, { collector: "memory" }),
    ],
  };
  results.platform = {
    series: [series(1, { os: windows ? "windows" : "linux" })],
  };
  for (const key of ["sourceAvailable", "sourceRequired"])
    results[key] = {
      series: [
        series(1, { source: "prometheus" }),
        series(1, { source: "alertmanager" }),
        series(0, { source: "bridge" }),
      ],
    };
  results.targets = {
    series: [
      series(1, {
        job: windows ? "foundation-windows" : "foundation-node",
        instance: "demo-exporter",
      }),
      series(1, {
        job: "services-demo",
        layer: "services",
        instance: "demo-collector",
      }),
    ],
  };
  results.components = {
    series: [
      series(1, {
        id: "demo-api",
        name: "catalog-api.service",
        kind: "unit",
        state: "healthy",
        owner: "demo-team",
      }),
      series(1, {
        id: "demo-db",
        name: "demo-postgres",
        kind: "container",
        state: "healthy",
        owner: "demo-team",
      }),
      series(1, {
        id: "demo-job",
        name: "archive-refresh.service",
        kind: "job",
        state: "maintenance",
        owner: "demo-team",
      }),
      series(1, {
        id: "demo-new",
        name: "unclassified-worker",
        kind: "container",
        state: "unknown",
        owner: "unassigned",
      }),
    ],
  };
  const mount = windows ? "C:" : "/";
  results.fsSize = {
    series: [series(values.diskTotal, { mountpoint: mount })],
  };
  results.fsAvailable = {
    series: [series(values.diskAvailable, { mountpoint: mount })],
  };
  results.expectedMounts = { series: [series(1, { mountpoint: mount })] };
  results.fsReadonly = { series: [series(0, { mountpoint: mount })] };
  results.fsError = { series: [series(0, { mountpoint: mount })] };
  for (const key of ["cpu", "ram", "disk", "rx", "tx"]) {
    const points: Series["points"] = Array.from({ length: 101 }, (_, i) => [
      now - PERIODS[period] * 1000 * (1 - i / 100),
      i >= 42 && i <= 48 ? null : values[key] * (0.9 + 0.1 * Math.sin(i / 7)),
    ]);
    results[key + "History"] = { series: [{ labels: { host }, points }] };
  }
  if (windows) {
    results.commitUsed = { series: [series(10 * 1024 ** 3)] };
    results.commitLimit = { series: [series(24 * 1024 ** 3)] };
    results.acPower = { series: [series(1)] };
    results.battery = { series: [series(82)] };
  }
  return { host, period, fetchedAt: now, latency: 24, results };
}
