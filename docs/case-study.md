# From infrastructure observations to a useful overview

## Problem

Host resources and application observations lived in different places. A green process check could coexist with missing data, intentionally paused components or stale measurements. The useful question was not merely whether a process existed, but what was actually observed and how recently.

## My role

I framed the monitoring requirements, designed the Raycast experience, implemented the integration and collector work with AI-assisted development, and checked results against source data. The platform components remain upstream projects rather than software I authored.

## Decisions

1. Reuse Prometheus/Grafana rather than introduce another database or API. Raycast reads a bounded query catalog through the existing datasource API.
2. Keep host resources and service state separate, with freshness and coverage visible. An unavailable source is not a healthy service.
3. Discover new components without silently approving them. Unclassified observations stay unknown until explicitly registered.
4. Use native Raycast actions around an SVG overview. The same renderer supports deterministic previews and tests.
5. Preserve gaps in historical series. Connecting missing samples would imply measurements that never occurred.
6. Separate the public demo from operational data. A viewer can inspect the product without infrastructure access.

## Result and evidence

This repository includes the actual renderer, view model and queries, an adapted read-only collector, and a portable snapshot merge command. The generated previews exercise Linux/Windows, maintenance, unknown and stale states. Behavioral tests cover the observation contracts; verification records describe exactly which checks ran.

No business ROI, universal infrastructure coverage, security-isolation guarantee or measured performance improvement is claimed. The public edition is a reviewed extraction from an operational integration, not a complete packaging of its private deployment.
