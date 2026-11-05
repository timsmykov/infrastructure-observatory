import type { Query } from "./catalog";

export const WINDOWS_RESOURCE_GROUPS = [
  "cpu",
  "memory",
  "swap",
  "filesystem",
  "io",
  "network",
  "clock",
  "kernel",
  "inventory",
] as const;

// Native Windows counters retain their units and volume names. Linux-only fields
// remain absent and are explicitly shown as not applicable by the view model.
export function withWindows(queries: Query[], host: string): Query[] {
  const h = `host=${JSON.stringify(host)}`;
  const w = `job="foundation-windows",${h}`;
  const device = (expr: string, source: string) =>
    `label_replace((${expr}),"device","$1","${source}","(.*)")`;
  const mount = (expr: string) =>
    `label_replace((${expr}),"mountpoint","$1","volume","(.*)")`;
  const disk = (name: string) => `windows_logical_disk_${name}{${w}}`;
  const net = (name: string) => `windows_net_${name}{${w}}`;
  const uplink = `nic!~"(?i).*(tailscale|virtualbox|loopback).*"`;
  const map: Record<string, string> = {
    cpu: `100*(1-avg by(host)(rate(windows_cpu_time_seconds_total{${w},mode="idle"}[5m])))`,
    ram: `100*(1-windows_memory_available_bytes{${w}}/windows_memory_physical_total_bytes{${w}})`,
    disk: `100*(1-windows_logical_disk_free_bytes{${w},volume="C:"}/windows_logical_disk_size_bytes{${w},volume="C:"})`,
    rx: `sum by(host)(rate(windows_net_bytes_received_total{${w},${uplink}}[5m]))`,
    tx: `sum by(host)(rate(windows_net_bytes_sent_total{${w},${uplink}}[5m]))`,
    ramAvailable: `windows_memory_available_bytes{${w}}`,
    ramTotal: `windows_memory_physical_total_bytes{${w}}`,
    diskAvailable: `windows_logical_disk_free_bytes{${w},volume="C:"}`,
    diskTotal: `windows_logical_disk_size_bytes{${w},volume="C:"}`,
    swapUsed: `sum by(host)(windows_pagefile_limit_bytes{${w}}-windows_pagefile_free_bytes{${w}})`,
    swapTotal: `sum by(host)(windows_pagefile_limit_bytes{${w}})`,
    swapIn: `rate(windows_memory_swap_pages_read_total{${w}}[5m])`,
    swapOut: `rate(windows_memory_swap_pages_written_total{${w}}[5m])`,
    majorFaults: `rate(windows_memory_swap_page_reads_total{${w}}[5m])`,
    sourceTime: `timestamp(windows_memory_physical_total_bytes{${w}})`,
    cores: `windows_cpu_logical_processor{${w}}`,
    expectedMounts: `foundation_windows_expected_mount{${w}}`,
    fsSize: mount(disk("size_bytes")),
    fsAvailable: mount(disk("free_bytes")),
    fsReadonly: mount(disk("readonly")),
    diskRead: device(`rate(${disk("read_bytes_total")}[5m])`, "volume"),
    diskWrite: device(`rate(${disk("write_bytes_total")}[5m])`, "volume"),
    diskReadOps: device(`rate(${disk("reads_total")}[5m])`, "volume"),
    diskWriteOps: device(`rate(${disk("writes_total")}[5m])`, "volume"),
    diskBusy: device(
      `100*clamp_min(1-clamp_max(rate(${disk("idle_seconds_total")}[5m]),1),0)`,
      "volume",
    ),
    diskQueue: device(
      `rate(${disk("read_seconds_total")}[5m])+rate(${disk("write_seconds_total")}[5m])`,
      "volume",
    ),
    diskReadLatency: device(
      `1000*rate(${disk("read_seconds_total")}[5m])/clamp_min(rate(${disk("reads_total")}[5m]),0.000001)`,
      "volume",
    ),
    diskWriteLatency: device(
      `1000*rate(${disk("write_seconds_total")}[5m])/clamp_min(rate(${disk("writes_total")}[5m]),0.000001)`,
      "volume",
    ),
    netRx: device(`rate(${net("bytes_received_total")}[5m])`, "nic"),
    netTx: device(`rate(${net("bytes_sent_total")}[5m])`, "nic"),
    netInfo: device(net("nic_info"), "nic"),
    netUp: device(`windows_net_nic_operation_status{${w},status="up"}`, "nic"),
    netSpeed: device(net("current_bandwidth_bytes"), "nic"),
    netErrors: device(
      `rate(${net("packets_received_errors_total")}[5m])+rate(${net("packets_outbound_errors_total")}[5m])`,
      "nic",
    ),
    netDrops: device(
      `rate(${net("packets_received_discarded_total")}[5m])+rate(${net("packets_outbound_discarded_total")}[5m])`,
      "nic",
    ),
    clockOffset: `timestamp(windows_time_current_timestamp_seconds{${w}})-windows_time_current_timestamp_seconds{${w}}`,
    uptime: `time()-windows_system_boot_time_timestamp{${w}}`,
    collectors: `windows_exporter_collector_success{${w}}`,
  };
  for (const key of ["cpu", "ram", "disk", "rx", "tx"])
    map[key + "History"] = map[key];
  return [
    ...queries.map((q) =>
      map[q.refId] ? { ...q, expr: `(${q.expr}) or (${map[q.refId]})` } : q,
    ),
    {
      refId: "platform",
      expr: `windows_os_info{${w}} or node_uname_info{job="foundation-node",${h}}`,
    },
    { refId: "cpuQueue", expr: `windows_system_processor_queue_length{${w}}` },
    { refId: "commitUsed", expr: `windows_memory_committed_bytes{${w}}` },
    { refId: "commitLimit", expr: `windows_memory_commit_limit_bytes{${w}}` },
    {
      refId: "battery",
      expr: `foundation_windows_battery_charge_percent{${h}}`,
    },
    { refId: "acPower", expr: `foundation_windows_ac_power{${h}}` },
    {
      refId: "systemEvents",
      expr: `foundation_windows_system_events_last_hour{${h}}`,
    },
    {
      refId: "profileSections",
      expr: `foundation_windows_section_success{${h}}`,
    },
    { refId: "volumeInfo", expr: `foundation_windows_volume_info{${h}}` },
  ];
}
