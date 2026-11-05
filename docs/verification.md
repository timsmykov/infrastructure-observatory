# Verification

Verified on 5 November 2026, Linux preparation host.

- 30 TypeScript behavioral tests passed, including the existing 26 monitoring cases and four demo/configuration/detail regressions.
- TypeScript checking, ESLint/Prettier validation and the Raycast extension build passed.
- Four Python collector/aggregation tests passed using mocked discovery and temporary files.
- A real browser rendered the generated synthetic Linux preview and both visual themes were inspected. The preview uses the extension renderer; this is not native macOS UI acceptance.
- Native macOS interaction and HTTPS authentication with a third-party Grafana are not verified by these checks.
- Live integration requires the custom profile metric contract described in integration.md; this release is not a turnkey exporter deployment.

Demo SVGs are deterministically generated from a fixed timestamp. They contain synthetic hosts only. Native demo mode uses the current clock and never connects to infrastructure.
