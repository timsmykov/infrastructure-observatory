import { DEMO_HOSTS, demoSnapshot } from "./demo";
import { spawn } from "node:child_process";
import { catalog, type Period, type Query, queryBody } from "./catalog";
import { parseResults, type QueryResult } from "./model";

export type Connection = {
  transport: string;
  centralHost?: string;
  sshHost?: string;
  grafanaUrl?: string;
  token?: string;
  datasource?: string;
  browserUrl?: string;
};
export class ConnectionError extends Error {
  constructor(
    public kind: "auth" | "offline" | "timeout" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

const REMOTE_QUERY =
  "curl --silent --show-error --fail-with-body --max-time 20 -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:3000/api/ds/query";

export function sshQuery(
  alias: string,
  body: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(alias))
    throw new ConnectionError(
      "invalid",
      "Enter an SSH alias from ~/.ssh/config, without commands or arguments.",
    );
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ConnectionError("offline", "Request cancelled."));
    const child = spawn(
      "/usr/bin/ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=2",
        alias,
        REMOTE_QUERY,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let oversized = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 25000);
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        oversized = true;
        child.kill("SIGKILL");
      } else chunks.push(chunk);
    });
    // Never return remote output on failure: it may include sensitive proxy diagnostics.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new ConnectionError("offline", "Could not start system SSH."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (timedOut)
        reject(
          new ConnectionError(
            "timeout",
            "Grafana did not respond within 25 seconds.",
          ),
        );
      else if (oversized)
        reject(
          new ConnectionError("invalid", "Grafana response exceeds 8 MiB."),
        );
      else if (signal?.aborted)
        reject(new ConnectionError("offline", "Request cancelled."));
      else if (code !== 0)
        reject(
          new ConnectionError(
            "offline",
            "SSH → Grafana is unavailable. Check your SSH alias, key, and Grafana on server loopback port 3000.",
          ),
        );
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(body);
  });
}

export async function request(
  connection: Connection,
  queries: Query[],
  period: Period,
  signal?: AbortSignal,
): Promise<Record<string, QueryResult>> {
  const body = JSON.stringify(
    queryBody(queries, connection.datasource || "foundation", period),
  );
  let raw: string;
  if (connection.transport === "ssh")
    raw = await sshQuery(connection.sshHost || "monitoring", body, signal);
  else {
    let url: URL;
    try {
      url = new URL(connection.grafanaUrl || "");
    } catch {
      throw new ConnectionError(
        "invalid",
        "Enter your private Grafana HTTPS URL in preferences.",
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new ConnectionError(
        "invalid",
        "Use an HTTPS URL without credentials, a query, or a fragment.",
      );
    if (!connection.token)
      throw new ConnectionError(
        "auth",
        "Enter a Grafana read token in the password preference.",
      );
    const timeout = AbortSignal.timeout(25000);
    try {
      const response = await fetch(
        `${url.toString().replace(/\/$/, "")}/api/ds/query`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${connection.token}`,
          },
          body,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        },
      );
      if (response.status === 401 || response.status === 403)
        throw new ConnectionError(
          "auth",
          "Grafana denied access. Check the read token and datasource permissions.",
        );
      if (!response.ok)
        throw new ConnectionError(
          "offline",
          `Grafana returned HTTP ${response.status}.`,
        );
      raw = await response.text();
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
        throw new ConnectionError("invalid", "Grafana response exceeds 8 MiB.");
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new ConnectionError(
        timeout.aborted ? "timeout" : "offline",
        timeout.aborted
          ? "Grafana did not respond within 25 seconds."
          : "Could not connect to Grafana over HTTPS.",
      );
    }
  }
  try {
    return parseResults(
      JSON.parse(raw),
      queries.map((q) => q.refId),
    );
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new ConnectionError(
      "invalid",
      "Grafana returned an invalid datasource API response.",
    );
  }
}

export async function discoverHosts(
  connection: Connection,
  signal?: AbortSignal,
): Promise<string[]> {
  if (connection.transport === "demo") return [...DEMO_HOSTS];
  const results = await request(
    connection,
    [
      {
        refId: "hosts",
        expr: 'count by(host) (up{job=~"foundation-(node|windows)"})',
      },
    ],
    "1h",
    signal,
  );
  const hosts = results.hosts.series
    .map((s) => s.labels.host)
    .filter(Boolean)
    .sort();
  if (results.hosts.error || !hosts.length)
    throw new ConnectionError(
      "invalid",
      "Grafana returned no infrastructure hosts.",
    );
  return [...new Set(hosts)];
}

export function readHost(
  connection: Connection,
  host: string,
  period: Period,
  signal?: AbortSignal,
) {
  if (connection.transport === "demo")
    return Promise.resolve(demoSnapshot(host, period).results);
  return request(
    connection,
    catalog(host, connection.centralHost),
    period,
    signal,
  );
}
