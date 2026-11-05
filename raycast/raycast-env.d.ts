/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Connection - Demo uses synthetic data and makes no network requests. */
  "transport": "demo" | "ssh" | "https",
  /** SSH Alias - An existing alias from ~/.ssh/config. */
  "sshHost": string,
  /** Grafana HTTPS URL - Required only for HTTPS connections. */
  "grafanaUrl"?: string,
  /** Grafana Read Token - HTTPS only. Use a scoped read token. */
  "token"?: string,
  /** Grafana Browser URL - Optional existing URL used by Open in Grafana actions. */
  "browserUrl"?: string,
  /** Prometheus Datasource UID - undefined */
  "datasource": string,
  /** Monitoring Host Label - Prometheus host label for shared monitoring-source and retention metrics. */
  "centralHost": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `dashboard` command */
  export type Dashboard = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `dashboard` command */
  export type Dashboard = {}
}

