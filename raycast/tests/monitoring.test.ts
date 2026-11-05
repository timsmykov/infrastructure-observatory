import test from "node:test";
import assert from "node:assert/strict";
import {
  catalog,
  literal,
  queryBody,
  RESOURCE_GROUPS,
} from "../src/lib/catalog";
import { request, sshQuery } from "../src/lib/client";
import {
  chartGaps,
  coverage,
  isWindows,
  layers,
  latest,
  parseResults,
  value,
  type QueryResult,
  type Snapshot,
} from "../src/lib/model";
import { dashboardSvg } from "../src/lib/render";
import { resourceSections } from "../src/lib/resource-details";

const now = 1800000000000;
const series = (v: number | null, labels: Record<string, string> = {}) => ({
  labels,
  points: [[now, v] as [number, number | null]],
});
function snapshot(): Snapshot {
  const results: Record<string, QueryResult> = {};
  for (const q of catalog("test")) results[q.refId] = { series: [] };
  for (const k of [
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
  ])
    results[k] = { series: [series(10)] };
  results.sourceTime = { series: [series(now / 1000 - 20)] };
  results.collection = { series: [series(now / 1000 - 60)] };
  results.profileTime = { series: [series(now / 1000 - 40)] };
  results.profileSuccess = { series: [series(1)] };
  results.notificationsPaused = { series: [series(1)] };
  results.coverage = {
    series: RESOURCE_GROUPS.map((group) => series(1, { group })),
  };
  results.collectors = { series: [series(1, { collector: "cpu" })] };
  results.sourceAvailable = {
    series: [
      series(1, { source: "prometheus" }),
      series(1, { source: "alertmanager" }),
      series(0, { source: "bridge" }),
    ],
  };
  results.sourceRequired = {
    series: [
      series(1, { source: "prometheus" }),
      series(1, { source: "alertmanager" }),
      series(0, { source: "bridge" }),
    ],
  };
  results.targets = {
    series: [
      series(1, { job: "foundation-node" }),
      series(1, { job: "services-test", layer: "services" }),
    ],
  };
  results.components = {
    series: [series(1, { id: "1", name: "test.service", state: "healthy" })],
  };
  return { host: "test", period: "1h", fetchedAt: now, latency: 100, results };
}
test("Grafana frames are matched by refId, labels and numeric field, not order", () => {
  const parsed = parseResults(
    {
      results: {
        B: {
          frames: [
            {
              schema: {
                fields: [
                  { type: "number", labels: { host: "test" } },
                  { type: "time" },
                ],
              },
              data: { values: [[4], [now]] },
            },
          ],
        },
        A: { frames: [] },
      },
    },
    ["A", "B"],
  );
  assert.equal(latest(parsed.B.series[0]), 4);
  assert.equal(parsed.B.series[0].labels.host, "test");
  assert.deepEqual(parsed.A.series, []);
});
test("null, NaN and missing values never become zero", () => {
  const r = parseResults(
    {
      results: {
        A: {
          frames: [
            {
              schema: { fields: [{ type: "time" }, { type: "number" }] },
              data: {
                values: [
                  [now - 1, now],
                  [7, null],
                ],
              },
            },
          ],
        },
      },
    },
    ["A", "B"],
  );
  assert.equal(latest(r.A.series[0]), undefined);
  assert.ok(r.B.error);
  assert.throws(() => parseResults({ message: "login" }, ["A"]));
});
test("partial errors preserve successful queries and do not echo server diagnostics", () => {
  const r = parseResults(
    { results: { A: { status: 500, error: "secret" }, B: { frames: [] } } },
    ["A", "B"],
  );
  assert.ok(r.A.error);
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.equal(r.B.error, undefined);
});
test("missing time field is a partial error", () => {
  assert.ok(
    parseResults(
      {
        results: {
          A: {
            frames: [
              {
                schema: { fields: [{ type: "number" }] },
                data: { values: [[1]] },
              },
            ],
          },
        },
      },
      ["A"],
    ).A.error,
  );
});
test("Grafana's empty frame is no-data, not a query error", () => {
  const result = parseResults(
    {
      results: {
        A: {
          status: 200,
          frames: [{ schema: { fields: [] }, data: { values: [] } }],
        },
      },
    },
    ["A"],
  );
  assert.deepEqual(result.A, { series: [] });
});
test("healthy layers require observed current data", () => {
  const s = snapshot();
  assert.equal(layers(s, now).foundation.status, "healthy");
  assert.equal(layers(s, now).services.status, "healthy");
});
test("stale collection overrides healthy component states", () => {
  const s = snapshot();
  s.results.collection = { series: [series(now / 1000 - 600)] };
  assert.equal(layers(s, now).services.status, "unknown");
});
test("a stale local cache cannot report a live healthy host", () => {
  const s = snapshot();
  assert.equal(layers(s, now + 300000).foundation.status, "unknown");
});
test("unhealthy, unknown and maintenance retain different states", () => {
  const s = snapshot();
  s.results.components = {
    series: [series(1, { id: "p", state: "maintenance" })],
  };
  s.results.probes = { series: [series(0, { component_id: "p" })] };
  assert.equal(layers(s, now).services.status, "maintenance");
  s.results.probes = { series: [] };
  s.results.components = { series: [series(1, { state: "unknown" })] };
  assert.equal(layers(s, now).services.status, "warning");
  s.results.components = { series: [series(1, { state: "unhealthy" })] };
  assert.equal(layers(s, now).services.status, "critical");
});
test("an application probe failure is independent of exporter health", () => {
  const s = snapshot();
  s.results.probes = { series: [series(0)] };
  assert.equal(layers(s, now).services.status, "critical");
});
test("missing resource query cannot produce a green foundation", () => {
  const s = snapshot();
  s.results.ram = { series: [] };
  assert.equal(value(s, "ram"), undefined);
  assert.equal(layers(s, now).foundation.status, "unknown");
});
test("one down scrape target is not hidden by healthy exporters", () => {
  const s = snapshot();
  s.results.targets.series.push(series(0, { job: "foundation-central" }));
  assert.equal(layers(s, now).foundation.status, "warning");
});
test("history gaps are not interpolated across missing samples", () => {
  assert.equal(
    chartGaps(
      [
        [0, 1],
        [1000, 2],
        [2000, null],
        [3000, 3],
        [10000, 4],
      ],
      1000,
    ).length,
    3,
  );
});
test("host values are escaped as PromQL literals and history is bounded", () => {
  const host = 'host"} or up{a="b';
  assert.equal(literal(host), JSON.stringify(host));
  for (const q of catalog(host).filter((q) => q.refId !== "globalAlerts"))
    assert.ok(
      q.expr.includes(`host=${JSON.stringify(host)}`) ||
        q.expr.includes('host="monitoring-node"'),
    );
  const body = queryBody(catalog("test"), "foundation", "24h", now);
  assert.equal(body.queries.filter((q) => q.range).length, 5);
  assert.ok(body.queries.every((q) => q.maxDataPoints <= 110));
  assert.equal(Number(body.to) - Number(body.from), 86400000);
});
test("transport rejects shell arguments, insecure URLs and missing HTTPS token", async () => {
  assert.throws(() => sshQuery("-oProxyCommand=anything", "{}"));
  assert.throws(() => sshQuery("monitoring; anything", "{}"));
  await assert.rejects(
    () =>
      request(
        {
          transport: "https",
          grafanaUrl: "http://example.com",
          token: "secret",
        },
        [],
        "1h",
      ),
    /HTTPS/,
  );
  await assert.rejects(
    () =>
      request(
        { transport: "https", grafanaUrl: "https://example.com" },
        [],
        "1h",
      ),
    /token/,
  );
});
test("SVG escapes labels and keeps offline/unknown visible in both themes", () => {
  const s = snapshot();
  s.host = "<script>&";
  for (const theme of ["dark", "light"] as const) {
    const svg = dashboardSvg(s, theme, "offline", now);
    assert.ok(svg.includes("&lt;script&gt;&amp;"));
    assert.ok(svg.includes("OFFLINE"));
    assert.ok(!svg.includes("<script>"));
  }
});

test("owner-paused bridge does not degrade healthy resources", () => {
  const s = snapshot();
  s.results.targets.series.push(
    series(0, { job: "foundation-central", instance: "127.0.0.1:3274" }),
  );
  assert.equal(layers(s, now).foundation.status, "healthy");
  s.results.notificationsPaused = { series: [series(0)] };
  s.results.sourceRequired.series[2] = series(1, { source: "bridge" });
  assert.equal(layers(s, now).foundation.status, "warning");
});
test("backend warning and critical severities remain distinct", () => {
  const s = snapshot();
  s.results.alerts = {
    series: [series(1, { layer: "foundation", severity: "warning" })],
  };
  assert.equal(layers(s, now).foundation.status, "warning");
  s.results.alerts.series[0].labels.severity = "critical";
  assert.equal(layers(s, now).foundation.status, "critical");
});
test("utilization alone does not contradict backend pressure policy", () => {
  const s = snapshot();
  s.results.ram = { series: [series(99)] };
  s.results.cpu = { series: [series(99)] };
  assert.equal(layers(s, now).foundation.status, "healthy");
});
test("missing group cannot report complete coverage", () => {
  const s = snapshot();
  s.results.coverage.series[0] = series(0, { group: "cpu" });
  assert.equal(layers(s, now).foundation.status, "unknown");
});
test("detail rows preserve zero OOM and non-applicable FAT inode counts", () => {
  const s = snapshot();
  s.results.oom24h = { series: [series(0)] };
  s.results.fsSize = {
    series: [
      series(100, {
        mountpoint: "/boot/efi",
        device: "/dev/sda15",
        fstype: "vfat",
      }),
    ],
  };
  s.results.fsFiles = { series: [series(0, { mountpoint: "/boot/efi" })] };
  const details = resourceSections(s, now).flatMap((section) => section.rows);
  assert.equal(details.find((r) => r.id === "oom24h")?.value, "0");
  assert.equal(
    details.find((r) => r.id === "inode-/boot/efi")?.value,
    "Not applicable",
  );
});
test("expected missing mount is visible without an observed row", () => {
  const s = snapshot();
  s.results.expectedMounts = { series: [series(1, { mountpoint: "/data" })] };
  const missing = resourceSections(s, now)
    .flatMap((section) => section.rows)
    .find((r) => r.id === "missing-/data");
  assert.equal(missing?.warning, true);
  assert.ok(missing?.value.includes("missing"));
});

function windowsSnapshot(): Snapshot {
  const s = snapshot();
  s.results.platform = {
    series: [series(1, { os: "windows", product: "Windows 10 Home" })],
  };
  s.results.coverage = {
    series: [
      "cpu",
      "memory",
      "swap",
      "filesystem",
      "io",
      "network",
      "clock",
      "kernel",
      "inventory",
    ].map((group) => series(1, { group })),
  };
  s.results.targets = {
    series: [
      series(1, { job: "foundation-windows" }),
      series(1, { job: "services-home-assistant-http", layer: "services" }),
    ],
  };
  s.results.cpuPressure = { series: [] };
  s.results.ioPressure = { series: [] };
  return s;
}
test("Windows uses nine applicable groups without fabricated Linux PSI", () => {
  const s = windowsSnapshot();
  assert.equal(isWindows(s), true);
  assert.equal(coverage(s).total, 9);
  assert.equal(layers(s, now).foundation.status, "healthy");
  s.results.ram = { series: [] };
  assert.equal(layers(s, now).foundation.status, "unknown");
});
test("Windows stale data and failed native collectors remain unknown", () => {
  const s = windowsSnapshot();
  s.results.collectors = { series: [series(0, { collector: "cpu" })] };
  assert.equal(layers(s, now).foundation.status, "unknown");
  s.results.collectors = { series: [series(1)] };
  s.results.profileTime = { series: [series(now / 1000 - 500)] };
  assert.equal(layers(s, now).foundation.status, "unknown");
});
test("Windows detail labels pagefile and not-applicable inode, NTP, PSI", () => {
  const s = windowsSnapshot();
  s.results.fsSize = { series: [series(100, { mountpoint: "C:" })] };
  s.results.fsAvailable = { series: [series(50, { mountpoint: "C:" })] };
  s.results.fsReadonly = { series: [series(0, { mountpoint: "C:" })] };
  const all = resourceSections(s, now).flatMap((x) => x.rows);
  assert.equal(
    all.find((x) => x.id === "swap")?.title,
    "Pagefile used / total",
  );
  for (const id of ["cpuPressure", "conntrack", "clockSync"])
    assert.equal(
      all.find((x) => x.id === id)?.value,
      "Not applicable on Windows",
    );
  assert.equal(all.find((x) => x.id === "inode-C:")?.value, "Not applicable");
  assert.equal(all.find((x) => x.id === "fs-state-C:")?.value, "Read-write");
  assert.ok(dashboardSvg(s, "dark", undefined, now).includes("DISK C:"));
});
test("Windows catalog uses native counters, C volume and bound network interfaces", () => {
  const q = catalog("home-windows");
  const by = (ref: string) => q.find((x) => x.refId === ref)!.expr;
  assert.match(by("cpu"), /windows_cpu_time_seconds_total/);
  assert.match(by("disk"), /volume="C:"/);
  assert.match(by("swapUsed"), /windows_pagefile_limit_bytes/);
  assert.match(by("rx"), /tailscale\|virtualbox\|loopback/);
  assert.match(by("expectedMounts"), /foundation_windows_expected_mount/);
  assert.doesNotMatch(by("cpuPressure"), /windows_|vector\(0\)/);
  assert.equal(q.length, new Set(q.map((x) => x.refId)).size);
});
