# Integration contract

## Synthetic versus live

The default Raycast transport is `demo`; it uses generated data only. Live mode requires your own Grafana and Prometheus setup. No supplied setting refers to the author's servers.

For SSH, configure an existing alias named `monitoring` (or change the preference). The client uses system SSH with BatchMode and strict known-host checking. The fixed remote command reads Grafana's datasource API at server loopback port 3000 using curl. This assumes the server permits that local read; it does not bypass Grafana authentication or configure access for you.

For HTTPS, supply an existing HTTPS URL and a scoped Grafana read token using the password preference. Redirects, URL credentials, queries and fragments are rejected. This optional transport needs testing against your own authentication setup; an end-to-end remote HTTPS setup was not established for this release.

Set the Prometheus datasource UID (default `foundation`) and central monitoring host label (default `monitoring-node`) to match your configuration.

## Read-only service collection

Python 3.10+ is sufficient; no Python packages are required. On a Linux host with existing systemctl/Docker inspection access:

```sh
cd collector
python3 -m service_metrics.collector --registry ../examples/registry.json --host demo-linux --output ./output/linux.json --prom ./output/linux.prom
```

This command reads the local machine, not synthetic fixture data. Choose an output directory you control. It runs systemctl and Docker inspection using your current permissions; Docker access can be privileged even when this collector's commands only inspect. It does not grant itself privileges or change services.

Use your own host label and reviewed registry. Generate stable IDs using `service_metrics.model.component_id`. New running units and discovered containers are emitted as unclassified/unknown. Collection failures are retained in `source_errors`.

Collect each host separately and transfer its snapshot using your own existing mechanism. Merge only explicit files:

```sh
python3 -m service_metrics.aggregate output/linux.json output/other-host.json --output output/combined.json --prom output/combined.prom
```

The aggregator rejects duplicate host labels. It does not connect to hosts or schedule collection. Configure your exporter/Prometheus to ingest the resulting metrics using your own reviewed deployment procedure.

## Resource metrics expected by the UI

`raycast/src/lib/catalog.ts` is the exact query catalog. Job labels use `foundation-node` and `foundation-windows`, with a `host` label. Standard resource series come from node_exporter/windows_exporter. The collector emits `infra_collection_seconds`, `infra_component_state` and `infra_observed_seconds`.

Additional profile/coverage series are an explicit integration contract, not values invented by the client:

| Metric | Meaning |
| --- | --- |
| `foundation_resource_group_present{host,group}` | A confirmed resource group; see RESOURCE_GROUPS / WINDOWS_RESOURCE_GROUPS in source |
| `foundation_resource_collection_seconds{host}` | Profile collection timestamp in seconds |
| `foundation_resource_inventory_success{host}` | Inventory result, 1 for successful observation |
| `foundation_monitoring_source_available{host,source}` | Availability of prometheus, alertmanager and bridge |
| `foundation_monitoring_source_required{host,source}` | Whether that source is required; 0 must be an explicit policy |
| `foundation_notifications_paused{host}` | Explicit owner pause marker |
| `foundation_resource_expected_mount{host,mountpoint}` | Expected Linux filesystem mount |
| `foundation_windows_expected_mount{host,mountpoint}` | Expected Windows volume |

Optional condition, conntrack, Windows profile and Prometheus-retention metrics are enumerated by the same catalog. This release exports the client contract rather than a new generic installer for the original profile collectors. Missing required profile metrics intentionally yield unknown.

Freshness limits are 180 seconds for source observations and 90 seconds for a cached snapshot. UI percentages are presentation, not modifications to backend alert rules. Network counters sum selected interfaces and do not prove unique Internet traffic.
