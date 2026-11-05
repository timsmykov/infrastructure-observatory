import { withWindows } from "./windows";
export type Period = "1h" | "6h" | "24h";
export const PERIODS: Record<Period, number> = {
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
};
export type Query = { refId: string; expr: string; range?: boolean };
export const RESOURCE_GROUPS = [
  "cpu",
  "load",
  "memory",
  "swap",
  "pressure",
  "filesystem",
  "io",
  "network",
  "clock",
  "conntrack",
  "files",
  "kernel",
  "inventory",
] as const;

// A PromQL string literal, not an interpolated matcher or regular expression.
export function literal(value: string): string {
  return JSON.stringify(value);
}

export function catalog(
  host: string,
  centralHost = "monitoring-node",
): Query[] {
  const h = `host=${literal(host)}`;
  const n = `job="foundation-node",${h}`;
  const net = `${n},device!~"lo|veth.*|docker.*|br-.*"`;
  const uplink = `${n},device!~"lo|veth.*|docker.*|br-.*|tailscale.*|tun.*|tap.*|wg.*|awg.*"`;
  const cpu = `100 * (1 - avg by(host) (rate(node_cpu_seconds_total{${n},mode="idle"}[5m])))`;
  const ram = `100 * (1 - node_memory_MemAvailable_bytes{${n}} / node_memory_MemTotal_bytes{${n}})`;
  const disk = `100 * (1 - node_filesystem_avail_bytes{${n},mountpoint="/"} / node_filesystem_size_bytes{${n},mountpoint="/"})`;
  const rx = `sum by(host) (rate(node_network_receive_bytes_total{${uplink}}[5m]))`;
  const tx = `sum by(host) (rate(node_network_transmit_bytes_total{${uplink}}[5m]))`;
  return withWindows(
    [
      { refId: "cpu", expr: cpu },
      { refId: "ram", expr: ram },
      { refId: "disk", expr: disk },
      { refId: "rx", expr: rx },
      { refId: "tx", expr: tx },
      { refId: "ramAvailable", expr: `node_memory_MemAvailable_bytes{${n}}` },
      { refId: "ramTotal", expr: `node_memory_MemTotal_bytes{${n}}` },
      {
        refId: "diskAvailable",
        expr: `node_filesystem_avail_bytes{${n},mountpoint="/"}`,
      },
      {
        refId: "diskTotal",
        expr: `node_filesystem_size_bytes{${n},mountpoint="/"}`,
      },
      {
        refId: "swapUsed",
        expr: `node_memory_SwapTotal_bytes{${n}} - node_memory_SwapFree_bytes{${n}}`,
      },
      { refId: "swapTotal", expr: `node_memory_SwapTotal_bytes{${n}}` },
      {
        refId: "cpuPressure",
        expr: `100 * rate(node_pressure_cpu_waiting_seconds_total{${n}}[5m])`,
      },
      {
        refId: "ioPressure",
        expr: `100 * rate(node_pressure_io_stalled_seconds_total{${n}}[5m])`,
      },
      { refId: "swapIn", expr: `rate(node_vmstat_pswpin{${n}}[5m])` },
      {
        refId: "sourceTime",
        expr: `timestamp(node_memory_MemTotal_bytes{${n}})`,
      },
      { refId: "collection", expr: `infra_collection_seconds{${h}}` },
      { refId: "targets", expr: `up{${h}}` },
      { refId: "components", expr: `infra_component_state{${h}} == 1` },
      {
        refId: "alerts",
        expr: `ALERTS{${h},alertstate="firing",alertname!="FoundationWatchdog"}`,
      },
      {
        refId: "globalAlerts",
        expr: `ALERTS{host="",alertstate="firing",alertname!="FoundationWatchdog"}`,
      },
      { refId: "probes", expr: `probe_success{${h}}` },
      { refId: "postgres", expr: `pg_up{${h}}` },
      { refId: "redis", expr: `redis_up{${h}}` },
      { refId: "jobs", expr: `time() - (infra_last_success{${h}} > 0)` },
      ...[
        ["cores", `count by(host)(node_cpu_seconds_total{${n},mode="idle"})`],
        [
          "steal",
          `100*avg by(host)(rate(node_cpu_seconds_total{${n},mode="steal"}[5m]))`,
        ],
        [
          "iowait",
          `100*avg by(host)(rate(node_cpu_seconds_total{${n},mode="iowait"}[5m]))`,
        ],
        ["load1", `node_load1{${n}}`],
        ["load5", `node_load5{${n}}`],
        ["load15", `node_load15{${n}}`],
        [
          "memoryPressure",
          `100*rate(node_pressure_memory_waiting_seconds_total{${n}}[5m])`,
        ],
        [
          "memoryStalled",
          `100*rate(node_pressure_memory_stalled_seconds_total{${n}}[5m])`,
        ],
        ["swapOut", `rate(node_vmstat_pswpout{${n}}[5m])`],
        ["majorFaults", `rate(node_vmstat_pgmajfault{${n}}[5m])`],
        ["oom24h", `increase(node_vmstat_oom_kill{${n}}[24h])`],
        ["fsSize", `node_filesystem_size_bytes{${n}}`],
        ["fsAvailable", `node_filesystem_avail_bytes{${n}}`],
        ["fsFiles", `node_filesystem_files{${n}}`],
        ["fsFilesFree", `node_filesystem_files_free{${n}}`],
        ["fsReadonly", `node_filesystem_readonly{${n}}`],
        ["fsError", `node_filesystem_device_error{${n}}`],
        ["expectedMounts", `foundation_resource_expected_mount{${h}}`],
        [
          "diskRead",
          `rate(node_disk_read_bytes_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskWrite",
          `rate(node_disk_written_bytes_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskReadOps",
          `rate(node_disk_reads_completed_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskWriteOps",
          `rate(node_disk_writes_completed_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskBusy",
          `100*rate(node_disk_io_time_seconds_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskQueue",
          `rate(node_disk_io_time_weighted_seconds_total{${n},device!~"loop.*|sr.*"}[5m])`,
        ],
        [
          "diskReadLatency",
          `1000*rate(node_disk_read_time_seconds_total{${n},device!~"loop.*|sr.*"}[5m])/clamp_min(rate(node_disk_reads_completed_total{${n},device!~"loop.*|sr.*"}[5m]),0.000001)`,
        ],
        [
          "diskWriteLatency",
          `1000*rate(node_disk_write_time_seconds_total{${n},device!~"loop.*|sr.*"}[5m])/clamp_min(rate(node_disk_writes_completed_total{${n},device!~"loop.*|sr.*"}[5m]),0.000001)`,
        ],
        ["netRx", `rate(node_network_receive_bytes_total{${net}}[5m])`],
        ["netTx", `rate(node_network_transmit_bytes_total{${net}}[5m])`],
        ["netInfo", `node_network_info{${n}}`],
        ["netUp", `node_network_up{${n}}`],
        ["netSpeed", `node_network_speed_bytes{${n}}`],
        [
          "netErrors",
          `rate(node_network_receive_errs_total{${net}}[5m])+rate(node_network_transmit_errs_total{${net}}[5m])`,
        ],
        [
          "netDrops",
          `rate(node_network_receive_drop_total{${net}}[5m])+rate(node_network_transmit_drop_total{${net}}[5m])`,
        ],
        ["retransmit", `rate(node_netstat_Tcp_RetransSegs{${n}}[5m])`],
        ["clockSync", `node_timex_sync_status{${n}}`],
        ["clockOffset", `node_timex_offset_seconds{${n}}`],
        ["uptime", `time()-node_boot_time_seconds{${n}}`],
        ["conntrack", `foundation_conntrack_entries{${h}}`],
        ["conntrackLimit", `foundation_conntrack_entries_limit{${h}}`],
        ["collectors", `node_scrape_collector_success{${n}}`],
        ["coverage", `foundation_resource_group_present{${h}}`],
        ["profileTime", `foundation_resource_collection_seconds{${h}}`],
        ["profileSuccess", `foundation_resource_inventory_success{${h}}`],
        ["notificationsPaused", `foundation_notifications_paused{${h}}`],
        [
          "sourceAvailable",
          `foundation_monitoring_source_available{host=${literal(centralHost)}}`,
        ],
        [
          "sourceRequired",
          `foundation_monitoring_source_required{host=${literal(centralHost)}}`,
        ],
        ["conditions", `foundation_resource_condition{${h}}`],
        [
          "historyOldest",
          `foundation_history_oldest_seconds{host=${literal(centralHost)}}`,
        ],
        [
          "historyBytes",
          `foundation_history_blocks_bytes{host=${literal(centralHost)}}`,
        ],
        [
          "historyLimit",
          `foundation_history_retention_bytes{host=${literal(centralHost)}}`,
        ],
        [
          "historyPolicy",
          `foundation_history_retention_seconds{host=${literal(centralHost)}}`,
        ],
        [
          "historyTime",
          `foundation_history_collection_seconds{host=${literal(centralHost)}}`,
        ],
      ].map(([refId, expr]) => ({ refId, expr })),
      ...[
        { refId: "cpuHistory", expr: cpu },
        { refId: "ramHistory", expr: ram },
        { refId: "diskHistory", expr: disk },
        { refId: "rxHistory", expr: rx },
        { refId: "txHistory", expr: tx },
      ].map((q) => ({ ...q, range: true })),
    ],
    host,
  );
}

export function queryBody(
  queries: Query[],
  datasource: string,
  period: Period,
  now = Date.now(),
) {
  const seconds = PERIODS[period];
  return {
    from: String(now - seconds * 1000),
    to: String(now),
    queries: queries.map((q) => ({
      ...q,
      datasource: { type: "prometheus", uid: datasource },
      instant: !q.range,
      range: !!q.range,
      format: "time_series",
      intervalMs: Math.ceil(seconds / 100) * 1000,
      maxDataPoints: 110,
    })),
  };
}
