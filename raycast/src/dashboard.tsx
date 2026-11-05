import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  List,
  LocalStorage,
  environment,
  getPreferenceValues,
  openExtensionPreferences,
  Keyboard,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Period } from "./lib/catalog";
import { type Connection, discoverHosts, readHost } from "./lib/client";
import {
  age,
  bytes,
  components,
  counts,
  duration,
  layers,
  isWindows,
  latest,
  percent,
  rows,
  targetCounts,
  value,
  type Snapshot,
} from "./lib/model";
import { dashboardSvg, imageMarkdown } from "./lib/render";
import { resourceSections } from "./lib/resource-details";

const connection = getPreferenceValues<Connection>();
const CACHE = "observatory-snapshot-v1";
const periodNames: Record<Period, string> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
};
type Cached = { scope: string; hosts: string[]; snapshot: Snapshot };
// No token in persistent state, URLs, logs, clipboard, or diagnostics.
const scope = JSON.stringify([
  connection.transport,
  connection.sshHost,
  connection.grafanaUrl,
  connection.datasource,
  connection.centralHost,
]);

export default function Dashboard() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [host, setHost] = useState<string>("");
  const [period, setPeriod] = useState<Period>("1h");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [list, setList] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const [now, setNow] = useState(Date.now());
  const active = useRef<AbortController | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    let alive = true;
    LocalStorage.getItem<string>(CACHE)
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          const cached = JSON.parse(raw) as Cached;
          if (
            cached.scope === scope &&
            Array.isArray(cached.hosts) &&
            cached.snapshot?.results &&
            ["1h", "6h", "24h"].includes(cached.snapshot.period) &&
            Number.isFinite(cached.snapshot.fetchedAt) &&
            cached.hosts.includes(cached.snapshot.host)
          ) {
            setHosts(cached.hosts);
            setPeriod(cached.snapshot.period);
            setHost(cached.snapshot.host);
            setSnapshot(cached.snapshot);
          }
        } catch {
          /* Discard an invalid cache and fetch fresh data. */
        }
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    const start = Date.now();
    try {
      const discovered = await discoverHosts(connection, controller.signal);
      if (controller.signal.aborted) return;
      setHosts(discovered);
      const selected = hostRef.current || discovered[0];
      if (!hostRef.current) {
        hostRef.current = selected;
        setHost(selected);
      }
      if (!discovered.includes(selected))
        throw new Error(
          "Selected host is unavailable. Choose a host with ⌘⇧H.",
        );
      const results = await readHost(
        connection,
        selected,
        period,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const fresh: Snapshot = {
        host: selected,
        period,
        results,
        fetchedAt: Date.now(),
        latency: Date.now() - start,
      };
      setSnapshot(fresh);
      setError(undefined);
      setNow(Date.now());
      const cached: Cached = { scope, hosts: discovered, snapshot: fresh };
      await LocalStorage.setItem(CACHE, JSON.stringify(cached));
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not refresh data.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 30000);
    const clock = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      clearInterval(interval);
      clearInterval(clock);
      active.current?.abort();
    };
  }, [ready, host, refresh]);

  const shown =
    snapshot?.host === host && snapshot.period === period
      ? snapshot
      : undefined;
  const browserBase =
    connection.transport === "demo"
      ? undefined
      : connection.browserUrl ||
        (connection.transport === "https" ? connection.grafanaUrl : undefined);
  const browserLink = (uid: string) =>
    browserBase && /^https?:\/\//.test(browserBase)
      ? `${browserBase.replace(/\/$/, "")}/d/${uid}?var-host=${encodeURIComponent(host || "")}&from=now-${period}&to=now`
      : undefined;
  const actions = (
    <ActionPanel>
      <ActionPanel.Section>
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={() => void refresh()}
        />
        <Action
          title={list ? "Show Dashboard" : "Show Details"}
          icon={list ? Icon.Gauge : Icon.List}
          shortcut={{ modifiers: ["cmd"], key: "l" }}
          onAction={() => setList(!list)}
        />
        <Action
          title={metadata ? "Hide Metadata" : "Show Metadata"}
          icon={Icon.Sidebar}
          shortcut={{ modifiers: ["cmd"], key: "i" }}
          onAction={() => setMetadata(!metadata)}
        />
      </ActionPanel.Section>
      <Action.Push
        title="Choose Host"
        icon={Icon.Desktop}
        shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
        target={
          <Picker
            title="Host"
            options={hosts.map((h) => ({ value: h, title: h }))}
            selected={host}
            onSelect={setHost}
          />
        }
      />
      <Action.Push
        title="Choose Period"
        icon={Icon.Clock}
        shortcut={{ modifiers: ["cmd"], key: "t" }}
        target={
          <Picker
            title="Period"
            options={(Object.keys(periodNames) as Period[]).map((p) => ({
              value: p,
              title: periodNames[p],
            }))}
            selected={period}
            onSelect={(p) => setPeriod(p as Period)}
          />
        }
      />
      <ActionPanel.Section title="Chart Range">
        {(Object.keys(periodNames) as Period[]).map((p, i) => (
          <Action
            key={p}
            title={`${p === period ? "✓ " : ""}${periodNames[p]}`}
            shortcut={{
              modifiers: ["cmd"],
              key: String(i + 1) as "1" | "2" | "3",
            }}
            onAction={() => setPeriod(p)}
          />
        ))}
      </ActionPanel.Section>
      <ActionPanel.Section>
        {browserLink("foundation-overview") && (
          <Action.OpenInBrowser
            title="Open Host Metrics in Grafana"
            url={browserLink("foundation-overview")!}
          />
        )}
        {browserLink("services-overview") && (
          <Action.OpenInBrowser
            title="Open Services in Grafana"
            url={browserLink("services-overview")!}
          />
        )}
        <Action
          title="Connection Preferences"
          icon={Icon.Gear}
          onAction={openExtensionPreferences}
        />
        <Action
          title="Clear Cached Snapshot"
          icon={Icon.Trash}
          onAction={async () => {
            await LocalStorage.removeItem(CACHE);
            setSnapshot(undefined);
            void refresh();
          }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
  const svg = useMemo(
    () =>
      shown
        ? dashboardSvg(shown, environment.appearance, error, now)
        : undefined,
    [shown, error, now],
  );
  if (!shown || !svg)
    return (
      <Detail
        navigationTitle={
          connection.transport === "demo"
            ? "Infrastructure · DEMO DATA"
            : "Infrastructure"
        }
        isLoading={loading}
        markdown={
          error
            ? `# No Connection\n\n${error}\n\n⌘R — retry · ⌘K — connection preferences`
            : `# Infrastructure\n\n${loading ? "Connecting to Grafana…" : "No snapshot for the selected host and period."}\n\nPrivate connection → two monitoring layers → infrastructure overview`
        }
        actions={actions}
      />
    );
  if (list)
    return (
      <Details
        snapshot={shown}
        error={error}
        loading={loading}
        actions={actions}
        now={now}
      />
    );
  const l = layers(shown, now);
  const t = targetCounts(shown);
  const c = counts(shown);
  const queryErrors = Object.values(shown.results).filter(
    (r) => r.error,
  ).length;
  return (
    <Detail
      navigationTitle={`${host} · ${period}`}
      isLoading={loading}
      markdown={imageMarkdown(
        svg,
        `${shown.fetchedAt}-${now}-${error || "ok"}`,
      )}
      actions={actions}
      metadata={
        metadata ? (
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Connection"
              text={
                error
                  ? "Refresh failed"
                  : connection.transport === "ssh"
                    ? "SSH → Grafana"
                    : "HTTPS → Grafana"
              }
              icon={{
                source: error ? Icon.WifiDisabled : Icon.Lock,
                tintColor: error ? Color.Orange : Color.Blue,
              }}
            />
            <Detail.Metadata.Label
              title="Snapshot"
              text={
                new Date(shown.fetchedAt).toLocaleString("en-GB", {
                  timeZone: "UTC",
                }) + " UTC"
              }
            />
            <Detail.Metadata.Label
              title="Host"
              text={duration(age(shown, "sourceTime", now)) + " ago"}
            />
            <Detail.Metadata.Label
              title="Services"
              text={duration(age(shown, "collection", now)) + " ago"}
            />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label
              title="Foundation"
              text={l.foundation.text}
            />
            <Detail.Metadata.Label title="Services" text={l.services.text} />
            <Detail.Metadata.Label
              title="Sources"
              text={`${t.up}/${t.total}`}
            />
            <Detail.Metadata.Label
              title="Maintenance"
              text={String(c.maintenance || 0)}
            />
            <Detail.Metadata.Label
              title="Query Errors"
              text={String(queryErrors)}
            />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label
              title="RAM"
              text={`${bytes(value(shown, "ramAvailable"))} / ${bytes(value(shown, "ramTotal"))} available`}
            />
            <Detail.Metadata.Label
              title={isWindows(shown) ? "Pagefile" : "Swap"}
              text={`${bytes(value(shown, "swapUsed"))} / ${bytes(value(shown, "swapTotal"))}`}
            />
            <Detail.Metadata.Label
              title="I/O pressure"
              text={
                isWindows(shown)
                  ? "Not applicable on Windows"
                  : percent(value(shown, "ioPressure"))
              }
            />
            <Detail.Metadata.Label
              title="Response"
              text={`${shown.latency} ms`}
            />
          </Detail.Metadata>
        ) : undefined
      }
    />
  );
}

function Picker({
  title,
  options,
  selected,
  onSelect,
}: {
  title: string;
  options: { value: string; title: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <List
      navigationTitle={title}
      searchBarPlaceholder={`Select: ${title.toLowerCase()}`}
    >
      {options.map((option) => (
        <List.Item
          key={option.value}
          title={option.title}
          icon={option.value === selected ? Icon.CheckCircle : Icon.Circle}
          accessories={option.value === selected ? [{ text: "Selected" }] : []}
          actions={
            <ActionPanel>
              <Action
                title="Select"
                onAction={() => {
                  onSelect(option.value);
                  pop();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function Details({
  snapshot: s,
  error,
  loading,
  actions,
  now,
}: {
  snapshot: Snapshot;
  error?: string;
  loading: boolean;
  actions: React.ReactNode;
  now: number;
}) {
  const cs = components(s).sort(
    (a, b) =>
      (({ unhealthy: 0, unknown: 1, maintenance: 2, healthy: 3 })[a.state] ??
        1) -
        ({ unhealthy: 0, unknown: 1, maintenance: 2, healthy: 3 }[b.state] ??
          1) || a.name.localeCompare(b.name),
  );
  const color = (state: string) =>
    state === "healthy"
      ? Color.Green
      : state === "unhealthy"
        ? Color.Red
        : state === "maintenance"
          ? Color.Purple
          : Color.Orange;
  return (
    <List
      navigationTitle={`${s.host} · details`}
      isLoading={loading}
      searchBarPlaceholder="Metric, service, source…"
      actions={actions}
    >
      <List.Section title="Observation">
        {error && (
          <List.Item
            title="Refresh Failed"
            subtitle={error}
            icon={{ source: Icon.WifiDisabled, tintColor: Color.Orange }}
            actions={actions}
          />
        )}
        <List.Item
          title="Host Observation"
          accessories={[{ text: duration(age(s, "sourceTime", now)) + " ago" }]}
          actions={actions}
        />
        <List.Item
          title="Service Observation"
          accessories={[{ text: duration(age(s, "collection", now)) + " ago" }]}
          actions={actions}
        />
        {Object.entries(s.results)
          .filter(([, r]) => r.error)
          .map(([key, r]) => (
            <List.Item
              key={key}
              title={key}
              subtitle={r.error}
              icon={{ source: Icon.Warning, tintColor: Color.Orange }}
              actions={actions}
            />
          ))}
      </List.Section>
      {resourceSections(s, now).map((section) => (
        <List.Section key={section.title} title={section.title}>
          {section.rows.map((r) => (
            <List.Item
              key={r.id}
              title={r.title}
              subtitle={r.subtitle}
              keywords={[section.title, r.value]}
              icon={
                r.warning
                  ? { source: Icon.Warning, tintColor: Color.Orange }
                  : undefined
              }
              accessories={[{ text: r.value }]}
              actions={actions}
            />
          ))}
        </List.Section>
      ))}
      <List.Section title="Active Signals">
        {[
          ...rows(s, "alerts"),
          ...rows(s, "globalAlerts"),
          ...rows(s, "conditions"),
        ]
          .filter((r) => latest(r) === 1)
          .map((r, i) => (
            <List.Item
              key={i}
              title={r.labels.alertname || r.labels.condition || "Signal"}
              subtitle={r.labels.name || r.labels.instance || "Global signal"}
              accessories={[
                {
                  tag: {
                    value: r.labels.severity || "warning",
                    color:
                      r.labels.severity === "critical"
                        ? Color.Red
                        : Color.Orange,
                  },
                },
              ]}
              actions={actions}
            />
          ))}
      </List.Section>
      <List.Section title={`Services and Applications · ${cs.length}`}>
        {cs.map((c) => (
          <List.Item
            key={c.id}
            title={c.name}
            subtitle={`${c.kind} · ${c.owner}`}
            keywords={[c.state, c.owner, c.kind]}
            icon={{
              source:
                c.state === "maintenance"
                  ? Icon.Pause
                  : c.state === "healthy"
                    ? Icon.CheckCircle
                    : Icon.Warning,
              tintColor: color(c.state),
            }}
            accessories={[{ tag: { value: c.state, color: color(c.state) } }]}
            actions={actions}
          />
        ))}
      </List.Section>
      <List.Section title="Application Probes">
        {["probes", "postgres", "redis", "jobs"].flatMap((key) =>
          rows(s, key).map((r, i) => (
            <List.Item
              key={`${key}-${i}`}
              title={
                r.labels.name ||
                r.labels.component_id ||
                r.labels.instance ||
                key
              }
              subtitle={key}
              accessories={[
                {
                  text:
                    key === "jobs"
                      ? `last success ${duration(latest(r))} ago`
                      : latest(r) === undefined
                        ? "No data"
                        : latest(r) === 1
                          ? "Available"
                          : "Unavailable",
                },
              ]}
              actions={actions}
            />
          )),
        )}
      </List.Section>
      <List.Section title="Sources">
        {rows(s, "targets").map((r, i) => (
          <List.Item
            key={i}
            title={r.labels.job || "Source"}
            subtitle={r.labels.instance}
            accessories={[
              {
                tag: {
                  value:
                    latest(r) === 1
                      ? "UP"
                      : latest(r) === 0
                        ? "DOWN"
                        : "UNKNOWN",
                  color: latest(r) === 1 ? Color.Green : Color.Orange,
                },
              },
            ]}
            actions={actions}
          />
        ))}
      </List.Section>
    </List>
  );
}
