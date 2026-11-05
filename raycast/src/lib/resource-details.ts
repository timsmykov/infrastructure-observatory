import {
  age,
  bytes,
  coverage,
  duration,
  latest,
  isWindows,
  percent,
  rows,
  value,
  type Snapshot,
} from "./model";

export type ResourceRow = {
  id: string;
  title: string;
  value: string;
  subtitle?: string;
  warning?: boolean;
};
export type ResourceSection = { title: string; rows: ResourceRow[] };
const number = (v: number | undefined, suffix = "", decimals = 2) =>
  v === undefined
    ? "No data"
    : `${v.toLocaleString("en-GB", { maximumFractionDigits: decimals })}${suffix}`;
const byLabel = (s: Snapshot, key: string, label: string, match: string) =>
  latest(rows(s, key).find((r) => r.labels[label] === match));

export function resourceSections(
  s: Snapshot,
  now = Date.now(),
): ResourceSection[] {
  const row = (
    id: string,
    title: string,
    v: string,
    subtitle?: string,
    warning?: boolean,
  ): ResourceRow => ({ id, title, value: v, subtitle, warning });
  const metric = (id: string, title: string, suffix = "", decimals = 2) =>
    row(id, title, number(value(s, id), suffix, decimals));
  const windows = isWindows(s);
  const cov = coverage(s),
    collectors = rows(s, "collectors");
  const sections: ResourceSection[] = [
    {
      title: "Collection Coverage and Freshness",
      rows: [
        row(
          "coverage",
          "Resource Groups",
          `${cov.present}/${cov.total}`,
          cov.missing.length
            ? `No data: ${cov.missing.join(", ")}`
            : "All groups observed",
          !!cov.missing.length,
        ),
        row(
          "collectors",
          "Collectors",
          `${collectors.filter((r) => latest(r) === 1).length}/${collectors.length}`,
          collectors
            .filter((r) => latest(r) !== 1)
            .map((r) => r.labels.collector)
            .join(", "),
        ),
        row(
          "profileTime",
          "Inventory",
          `${duration(age(s, "profileTime", now))} ago`,
          value(s, "profileSuccess") === 1
            ? windows
              ? "Windows volume and profile inventory succeeded"
              : "Mount inventory succeeded"
            : "Inventory failed",
          value(s, "profileSuccess") !== 1,
        ),
        row(
          "sourceTime",
          "Last Host Observation",
          `${duration(age(s, "sourceTime", now))} ago`,
        ),
        row(
          "notifications",
          "Notifications",
          value(s, "notificationsPaused") === 1
            ? "Paused by owner"
            : value(s, "notificationsPaused") === 0
              ? "No pause marker"
              : "No data",
          "Collection health is evaluated separately",
        ),
      ],
    },
    {
      title: "CPU and Run Queue",
      rows: [
        metric("cores", "vCPU", "", 0),
        row("cpu", "Non-idle CPU", percent(value(s, "cpu"))),
        row("steal", "CPU steal", percent(value(s, "steal"))),
        row("iowait", "CPU iowait", percent(value(s, "iowait"))),
        row("cpuPressure", "CPU pressure", percent(value(s, "cpuPressure"))),
        row(
          "load",
          "Load 1 / 5 / 15",
          ["load1", "load5", "load15"]
            .map((k) => number(value(s, k)))
            .join(" / "),
        ),
        row("uptime", "Uptime", duration(value(s, "uptime"))),
      ],
    },
    {
      title: "RAM, Swap and Memory Pressure",
      rows: [
        row(
          "ram",
          "RAM available / total",
          `${bytes(value(s, "ramAvailable"))} / ${bytes(value(s, "ramTotal"))}`,
        ),
        row(
          "memoryPressure",
          "Memory pressure",
          percent(value(s, "memoryPressure")),
        ),
        row(
          "memoryStalled",
          "Memory stalled",
          percent(value(s, "memoryStalled")),
        ),
        row(
          "swap",
          "Swap used / total",
          `${bytes(value(s, "swapUsed"))} / ${bytes(value(s, "swapTotal"))}`,
        ),
        metric("swapIn", "Swap-in", " pages/s"),
        metric("swapOut", "Swap-out", " pages/s"),
        metric("majorFaults", "Major page faults", "/s"),
        metric("oom24h", "OOM events in 24 hours", "", 0),
      ],
    },
  ];
  const mounts = rows(s, "fsSize");
  const filesystemRows: ResourceRow[] = [];
  for (const fs of mounts) {
    const mount = fs.labels.mountpoint || "?",
      size = latest(fs),
      available = byLabel(s, "fsAvailable", "mountpoint", mount),
      files = byLabel(s, "fsFiles", "mountpoint", mount),
      freeFiles = byLabel(s, "fsFilesFree", "mountpoint", mount);
    const ro = byLabel(s, "fsReadonly", "mountpoint", mount),
      error = byLabel(s, "fsError", "mountpoint", mount);
    filesystemRows.push(
      row(
        `fs-${mount}`,
        mount,
        `${bytes(available)} / ${bytes(size)} free`,
        windows
          ? rows(s, "volumeInfo").find((r) => r.labels.volume === mount)?.labels
              .filesystem || "Filesystem type unavailable"
          : [fs.labels.device, fs.labels.fstype].filter(Boolean).join(" · ") ||
              "Filesystem metadata unavailable",
        ro === 1 || error === 1,
      ),
    );
    filesystemRows.push(
      row(
        `inode-${mount}`,
        `${mount} · inode`,
        windows || files === 0
          ? "Not applicable"
          : files === undefined || freeFiles === undefined
            ? "No data"
            : `${number(freeFiles, "", 0)} / ${number(files, "", 0)} free`,
      ),
    );
    filesystemRows.push(
      row(
        `fs-state-${mount}`,
        `${mount} · access`,
        error === 1
          ? "Filesystem read error"
          : ro === 1
            ? "Read-only"
            : ro === 0 && (windows || error === 0)
              ? "Read-write"
              : "No data",
      ),
    );
  }
  for (const expected of rows(s, "expectedMounts"))
    if (!mounts.some((r) => r.labels.mountpoint === expected.labels.mountpoint))
      filesystemRows.push(
        row(
          `missing-${expected.labels.mountpoint}`,
          expected.labels.mountpoint,
          "Expected but missing",
          undefined,
          true,
        ),
      );
  sections.push({
    title: "Filesystems · Persistent Mounts and Host tmpfs",
    rows: filesystemRows.length
      ? filesystemRows
      : [row("fs-none", "Filesystems", "No data", undefined, true)],
  });
  const disks = rows(s, "diskBusy");
  const ioRows: ResourceRow[] = [];
  for (const disk of disks) {
    const device = disk.labels.device;
    const get = (key: string) => byLabel(s, key, "device", device);
    ioRows.push(
      row(
        `io-${device}`,
        device,
        `↓ ${bytes(get("diskRead"))}/s · ↑ ${bytes(get("diskWrite"))}/s`,
      ),
    );
    ioRows.push(
      row(
        `io-busy-${device}`,
        `${device} · busy / queue`,
        `${percent(latest(disk))} / ${number(get("diskQueue"))}`,
      ),
    );
    ioRows.push(
      row(
        `io-latency-${device}`,
        `${device} · read / write latency`,
        `${get("diskReadOps") === 0 ? "no reads" : number(get("diskReadLatency"), " ms")} / ${get("diskWriteOps") === 0 ? "no writes" : number(get("diskWriteLatency"), " ms")}`,
        windows
          ? "5-minute average, Windows logical volume"
          : "5-minute average, guest disk",
      ),
    );
  }
  ioRows.push(
    row("io-pressure", "I/O stalled", percent(value(s, "ioPressure"))),
  );
  sections.push({ title: "Block I/O", rows: ioRows });
  const netRows: ResourceRow[] = [];
  const interfaces = new Set(
    [...rows(s, "netInfo"), ...rows(s, "netRx")]
      .map((r) => r.labels.device)
      .filter(Boolean),
  );
  for (const device of interfaces) {
    const info = rows(s, "netInfo").find((r) => r.labels.device === device),
      up = byLabel(s, "netUp", "device", device),
      speed = byLabel(s, "netSpeed", "device", device);
    netRows.push(
      row(
        `net-${device}`,
        device,
        `↓ ${bytes(byLabel(s, "netRx", "device", device))}/s · ↑ ${bytes(byLabel(s, "netTx", "device", device))}/s`,
        `${up === 1 ? "Link up" : up === 0 ? "Link down" : "Link: no data"} · ${windows ? info?.labels.friendly_name || "Windows" : info?.labels.operstate || "operstate unavailable"}`,
      ),
    );
    netRows.push(
      row(
        `net-errors-${device}`,
        `${device} · errors / drops`,
        `${number(byLabel(s, "netErrors", "device", device), "/s")} / ${number(byLabel(s, "netDrops", "device", device), "/s")}`,
      ),
    );
    netRows.push(
      row(
        `net-speed-${device}`,
        `${device} · reported speed`,
        speed !== undefined && speed > 0
          ? `${bytes(speed)}/s`
          : "Not reported by guest OS",
      ),
    );
  }
  netRows.push(metric("retransmit", "TCP retransmissions", "/s"));
  netRows.push(
    row(
      "conntrack",
      "Connection Tracking",
      `${number(value(s, "conntrack"), "", 0)} / ${number(value(s, "conntrackLimit"), "", 0)}`,
      "Two /proc counters; connection contents are not inspected",
    ),
  );
  sections.push({ title: "Network Interfaces and Limits", rows: netRows });
  sections.push({
    title: "Time Synchronization",
    rows: [
      row(
        "clockSync",
        "NTP",
        value(s, "clockSync") === 1
          ? "Synchronized"
          : value(s, "clockSync") === 0
            ? "Not synchronized"
            : "No data",
        undefined,
        value(s, "clockSync") !== 1,
      ),
      metric("clockOffset", "Clock offset", " s", 6),
    ],
  });
  const sources = rows(s, "sourceAvailable").map((r) => {
    const required = byLabel(s, "sourceRequired", "source", r.labels.source);
    return row(
      `source-${r.labels.source}`,
      r.labels.source,
      required === 0
        ? "Not required · paused"
        : latest(r) === 1
          ? "Available"
          : "Unavailable",
      undefined,
      required !== 0 && latest(r) !== 1,
    );
  });
  sections.push({ title: "Monitoring Sources", rows: sources });
  sections.push({
    title: "Shared Prometheus Storage History",
    rows: [
      row(
        "historyAge",
        "Recorded History",
        duration(age(s, "historyOldest", now)),
      ),
      row(
        "historyPolicy",
        "Time Retention",
        duration(value(s, "historyPolicy")),
      ),
      row(
        "historyBytes",
        "Blocks / Limit",
        `${bytes(value(s, "historyBytes"))} / ${bytes(value(s, "historyLimit"))}`,
        "WAL and head require additional space",
      ),
      row(
        "historyFresh",
        "Storage Observation",
        `${duration(age(s, "historyTime", now))} ago`,
      ),
    ],
  });
  if (windows) {
    const na = new Set([
      "steal",
      "iowait",
      "cpuPressure",
      "load",
      "memoryPressure",
      "memoryStalled",
      "oom24h",
      "io-pressure",
      "conntrack",
      "clockSync",
    ]);
    for (const section of sections)
      for (const r of section.rows) {
        if (na.has(r.id)) {
          r.value = "Not applicable on Windows";
          r.subtitle = undefined;
          r.warning = false;
        }
        if (r.id === "swap") r.title = "Pagefile used / total";
        if (r.id === "swapIn") r.title = "Page-in";
        if (r.id === "swapOut") r.title = "Page-out";
        if (r.id === "majorFaults") r.title = "Disk Page Reads";
        if (r.id === "clockOffset") {
          r.title = "Offset from Collection Server";
          r.subtitle =
            "Includes request latency; does not establish NTP synchronization";
        }
      }
    sections[2].title = "RAM, Commit and Pagefile";
    sections[2].rows.push(
      row(
        "commit",
        "Commit Used / Limit",
        `${bytes(value(s, "commitUsed"))} / ${bytes(value(s, "commitLimit"))}`,
      ),
    );
    sections[1].rows.push(metric("cpuQueue", "CPU Queue", "", 0));
    const filesystemSection = sections.find((x) =>
      x.title.startsWith("Filesystems"),
    );
    if (filesystemSection)
      filesystemSection.title = "Filesystems · Windows Volumes";
    sections.push({
      title: "Windows · Power and System Events",
      rows: [
        row("battery", "Battery Charge", percent(value(s, "battery"))),
        row(
          "acPower",
          "Power",
          value(s, "acPower") === 1
            ? "AC power"
            : value(s, "acPower") === 0
              ? "Battery power"
              : "No data",
        ),
        ...rows(s, "systemEvents").map((r) =>
          row(
            "events-" + r.labels.level,
            r.labels.level === "1"
              ? "Critical Events in Last Hour"
              : "System Errors in Last Hour",
            number(latest(r), "", 0),
            "Counters only, no event contents; sample capped at 200 records",
          ),
        ),
      ],
    });
  }
  return sections;
}
