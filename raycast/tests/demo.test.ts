import test from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot, DEMO_HOSTS } from "../src/lib/demo";
import { counts, layers, chartGaps } from "../src/lib/model";
import { dashboardSvg } from "../src/lib/render";
import { catalog } from "../src/lib/catalog";
import { resourceSections } from "../src/lib/resource-details";

const now = Date.parse("2026-11-05T12:00:00Z");
test("synthetic Linux and Windows demos exercise classification without hiding gaps", () => {
  for (const host of DEMO_HOSTS.slice(0, 2)) {
    const s = demoSnapshot(host, "6h", now);
    assert.equal(layers(s, now).foundation.status, "healthy");
    assert.equal(layers(s, now).services.status, "warning");
    assert.deepEqual(counts(s), { healthy: 2, maintenance: 1, unknown: 1 });
    assert.equal(
      chartGaps(s.results.cpuHistory.series[0].points, 216000).length,
      2,
    );
    for (const theme of ["dark", "light"] as const) {
      const svg = dashboardSvg(s, theme, undefined, now);
      assert.match(svg, /SYNTHETIC DEMO/);
      assert.doesNotMatch(svg, /[А-Яа-яЁё]|NaN|undefined/);
    }
  }
});
test("stale demo remains unknown despite its fresh retrieval time", () => {
  const s = demoSnapshot("demo-stale", "1h", now);
  assert.equal(layers(s, now).foundation.status, "unknown");
  assert.equal(layers(s, now).services.status, "unknown");
});
test("filesystem details remain explicit when observation labels are missing", () => {
  const snapshot = demoSnapshot("demo-linux", "6h", now);
  const details = () => resourceSections(snapshot, now).flatMap((s) => s.rows);
  assert.match(details().find((r) => r.id === "fs-/")!.subtitle!, /ext4/);
  delete snapshot.results.fsSize.series[0].labels.device;
  delete snapshot.results.fsSize.series[0].labels.fstype;
  assert.equal(
    details().find((r) => r.id === "fs-/")!.subtitle,
    "Filesystem metadata unavailable",
  );
  assert.doesNotMatch(JSON.stringify(details()), /undefined|NaN/);
});
test("central monitoring host is configurable and escaped as a PromQL literal", () => {
  const q = catalog("worker", 'central"node').find(
    (q) => q.refId === "sourceAvailable",
  )!;
  assert.ok(q.expr.includes(JSON.stringify('central"node')));
  assert.throws(() => demoSnapshot("non-demo-host"));
});
