# argocd-extension-metrics — Design Specification

> **Version:** 1.1 — 2026-03-27
> **Scope:** Current-state baseline + planned roadmap
> **Audience:** Contributors, maintainers, UX reviewers

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [User Personas & Goals](#2-user-personas--goals)
3. [Current Architecture Baseline](#3-current-architecture-baseline)
4. [UI/UX Specification (Current)](#4-uiux-specification-current)
   - 4.1 [Metrics Tab — Main View](#41-metrics-tab--main-view)
   - 4.2 [Time-Series Line Chart](#42-time-series-line-chart)
   - 4.3 [Anomaly Chart](#43-anomaly-chart)
   - 4.4 [Pie / Average Chart](#44-pie--average-chart)
   - 4.5 [Empty / Loading States](#45-empty--loading-states)
5. [API Contract (Current)](#5-api-contract-current)
6. [Configuration Model (Current)](#6-configuration-model-current)
7. [Roadmap — Planned Features](#7-roadmap--planned-features)
   - 7.1 [Wavefront Provider GA](#71-wavefront-provider-ga)
   - 7.2 [Multiple Metrics Providers](#72-multiple-metrics-providers)
   - 7.3 [Config UI (In-cluster editor)](#73-config-ui-in-cluster-editor)
   - 7.4 [Health Score Summary Bar](#74-health-score-summary-bar)
   - 7.5 [Alerting Integration](#75-alerting-integration)
   - 7.6 [Additional Resource Kinds](#76-additional-resource-kinds)
   - 7.7 [Security Hardening](#77-security-hardening)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Open Questions](#9-open-questions)

---

## 1. Product Overview

`argocd-extension-metrics` adds a **Metrics tab** to the ArgoCD Resource panel, surfacing real-time observability data (golden signals: latency, errors, traffic, CPU, memory, anomaly scores) without leaving the ArgoCD UI.

**System context:**
```
Developer (browser)
  └── ArgoCD UI
        └── Metrics tab (this extension)
              └── ArgoCD API proxy  (/extensions/metrics/*)
                    └── argocd-metrics-server  (Go, port 9003)
                          ├── Prometheus (primary)
                          └── Wavefront (alpha)
```

**Key constraints:**
- Works only with Argo CD ≥ 2.6 (proxy extension feature flag required)
- Metrics server runs as a sidecar Deployment in the `argocd` namespace
- Config is entirely file-based (ConfigMap mount at `app/config.json`)
- Frontend is a compiled JS bundle loaded as an ArgoCD UI extension

---

## 2. User Personas & Goals

| Persona | Goal | Pain point solved |
|---|---|---|
| **App developer** | Spot performance regressions immediately after a deploy | No more context-switching between ArgoCD and Grafana |
| **SRE / on-call** | Confirm a rollout is healthy by checking golden signals | Can correlate K8s events with metric spikes in one view |
| **Platform engineer** | Configure dashboards per app/resource without touching ArgoCD | ConfigMap-driven config, no code changes needed |

---

## 3. Current Architecture Baseline

### Component inventory

| Component | Language | Location | Purpose |
|---|---|---|---|
| `argocd-metrics-server` | Go 1.21 | `cmd/`, `internal/` | HTTP server, PromQL execution, Wavefront queries |
| `PrometheusProvider` | Go | `internal/server/prometheus.go` | Prometheus range queries via Go `text/template` PromQL (must use `text/template`, not `html/template` — the latter escapes `{}` breaking PromQL) |
| `WavefrontProvider` | Go | `internal/server/wavefront.go` | Alpha Wavefront support |
| `TLS` | Go | `internal/tls/tls.go` | Auto self-signed ECDSA P-256 cert |
| `UI Extension` | TypeScript/React | `extensions/.../ui/src/` | ArgoCD panel extension |
| `ChartWrapper` | React | `…/Chart/ChartWrapper.tsx` | Data fetch + response normalization |
| `TimeSeriesChart` | React/Recharts | `…/Chart/Chart.tsx` | Line chart with events & thresholds |
| `AnomalyChart` | React/Recharts | `…/Chart/AnomalyChart.tsx` | Gradient area chart for anomaly scores |
| `CustomPie` | React/Recharts | `…/Pie/Pie.tsx` | Average-value pie chart |

### Request flow (sequence)

```
User clicks resource tab
  │
  ├─► index.tsx: fetchEvents(ArgoCD /api/v1/applications/{app}/events)
  │
  └─► Metrics.tsx: getDashBoard()
        GET /extensions/metrics/api/applications/{app}/groupkinds/{kind}/dashboards
        Headers: Argocd-Application-Name, Argocd-Project-Name
        │
        └─► server.go: validate headers → prometheus.getDashboard()
              Returns: Dashboard JSON (tabs, rows, graphs)

  For each graph visible in active tab:
  ChartWrapper → apiCall(queryPath)
    GET /extensions/metrics/api/applications/{app}/groupkinds/{kind}/rows/{row}/graphs/{graph}
        ?name=&namespace=&duration=1h&uid=&application_name=&project=
    │
    └─► prometheus.execute()
          1. Load Graph config from O11yConfig
          2. Go template interpolation → PromQL string
          3. client.QueryRange(now-duration, now, step=60s)
          4. Optional threshold queries
          Returns: AggregatedResponse{Data, Thresholds}
```

### Security model

- ArgoCD API server validates the JWT before proxying to the extension
- The extension server cross-validates `Argocd-Application-Name` / `Argocd-Project-Name` headers against URL parameters to prevent parameter injection
- TLS is enabled by default between ArgoCD proxy and the metrics server

---

## 4. UI/UX Specification (Current)

### 4.1 Metrics Tab — Main View

The Metrics tab replaces the standard ArgoCD resource panel content area.

**Wireframe — Main view (Deployment, Golden Signal tab)**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SUMMARY  EVENTS  LOGS  MANIFEST  DIFF  DESIREDMANIFEST  LIVE MANIFEST      │
│  ─────────────────────────────────────────────────────── [ METRICS ] ─────  │
│                                                                             │
│  [GoldenSignal]  [More]          Duration: [1h] [2h] [6h] [12h] [24h]     │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ┌─ HTTP Latency ─────────────────────────────────────────────────────────┐ │
│  │  ┌────────────────────────────────────────────────────────────────┐    │ │
│  │  │  [line chart: Latency]                              [?] title  │    │ │
│  │  │  ╭─────────────────────────────────────────────────────────╮   │    │ │
│  │  │  │  0.8 ─┤         ╭────╮                                  │   │    │ │
│  │  │  │  0.6 ─┤    ╭────╯    ╰───╮    ╭────╮                    │   │    │ │
│  │  │  │  0.4 ─┤────╯             ╰────╯    ╰────────────────    │   │    │ │
│  │  │  │  0.2 ─┤                                                  │   │    │ │
│  │  │  │       └──────────────────────────────────────────────    │   │    │ │
│  │  │  │       10:00    11:00    12:00    13:00    14:00          │   │    │ │
│  │  │  │  ● pod-abc123 ● pod-def456   [Show thresholds □]        │   │    │ │
│  │  │  ╰─────────────────────────────────────────────────────────╯   │    │ │
│  │  └────────────────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ HTTP Error Rate ──────────────────────────────────────────────────────┐ │
│  │  ┌──────────────────────────────────┐  ┌──────────────────────────┐   │ │
│  │  │  [line chart: HTTP Error 500]    │  │  [line chart: HTTP 404]  │   │ │
│  │  │  (same layout as above)          │  │  (same layout as above)  │   │ │
│  │  └──────────────────────────────────┘  └──────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Pods ─────────────────────────────────────────────────────────────────┐ │
│  │  ┌──────────────────────────┐  ┌────────┐  ┌──────────────────────┐   │ │
│  │  │  [line: CPU]             │  │[pie:   │  │  [line: Memory]      │   │ │
│  │  │                          │  │ CPU    │  │                      │   │ │
│  │  │                          │  │ Avg]   │  │                      │   │ │
│  │  └──────────────────────────┘  └────────┘  └──────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior rules:**
- Tabs are rendered from `dashboard.tabs[]`; rows without a matching tab appear under "More"
- Duration buttons trigger a full re-fetch of all graphs in the active tab
- Switching tabs does not re-fetch; data is fetched per-tab on first activation (future: lazy loading per row)

---

### 4.2 Time-Series Line Chart

**Component:** `Chart.tsx` → `TimeSeriesChart`

**Wireframe — chart detail**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Latency                                                          [?]  ▼  │  ← title + tooltip (description)
│  ─────────────────────────────────────────────────────────────────────── │
│  1.2 ─┤                           ⚡                                      │  ← K8s event reference line
│  1.0 ─┤         ╭─────╮           │                                      │
│  0.8 ─┤    ╭────╯     ╰─────╮     │  ╭─────╮                            │
│  0.6 ─┤────╯               ╰─────────╯     ╰──────────────────          │
│  0.4 ─┤- - - - - - - - - - - - - - - - - - - - - - - - - - - -          │  ← threshold (dashed)
│  0.2 ─┤                                                                  │
│       └──────────────────────────────────────────────────────────────    │
│       10:00       11:00       12:00       13:00       14:00              │
│                                                                          │
│  Legend:  ●──── pod-abc123 [0.82s]   ●──── pod-def456 [0.61s]          │
│                                             [Show thresholds □]         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Interaction states:**

| State | Behavior |
|---|---|
| Hover chart area | Cursor syncs across all charts (`syncId="o11yCharts"`); legend values update in-place (DOM write, no re-render) |
| Click legend item | Toggles series visibility; synced to pie chart segments |
| Hover legend item | Highlights that series; dims others |
| Hover ⚡ event line | Tippy popover: event reason + count (e.g. `Readiness: 3`) |
| Check "Show thresholds" | Overlays dashed threshold series; checkbox only visible when thresholds configured |
| Hover `[?]` y-axis label | Tippy tooltip shows graph `description` field |

**Data gap handling:** If consecutive data points are more than 61 seconds apart, a `null` is inserted to break the line (prevents false continuity during metric scrape gaps).

---

### 4.3 Anomaly Chart

**Component:** `AnomalyChart.tsx`

**Wireframe**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Anomaly Score                                                    [?]    │
│  ─────────────────────────────────────────────────────────────────────── │
│  10─┤                                        ●  ●                        │  ● = HIGH (red dot)
│   7─┤ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄         │  ← highLine = 7
│   5─┤           ◆  ◆                  ◆  ◆                               │  ◆ = MED (yellow dot)
│   4─┤ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄         │  ← medLine = 4
│   2─┤■■■■■■     ■■■■■■■■■■■     ■■■■■     ■■■■■■■■                     │  ■ = LOW (green dot)
│   0─┤                                                                    │
│       ╰── gradient fill: green → yellow → red  (by threshold bands)     │
│       10:00       11:00       12:00       13:00                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Severity mapping:**

| Score range | Color | Meaning |
|---|---|---|
| 0 – 4 | Green | Normal |
| 4 – 7 | Yellow | Elevated |
| 7 – 10 | Red | Critical |

Thresholds are currently hardcoded (`medLine=4`, `highLine=7`). See roadmap §7 for configurable thresholds.

---

### 4.4 Pie / Average Chart

**Component:** `Pie.tsx` → `CustomPie`

**Wireframe**

```
     CPU Avg
  ╭─────────╮
  │  ╭───╮  │   ● pod-abc  42%
  │ ╱  ╲  │   ● pod-def  33%
  │╱  ╲ │   ● pod-ghi  25%
  │        │
  ╰─────────╯
```

- Displays average value per series over the full time window
- Segments dim when the corresponding series is filtered out in the companion line chart
- Clicking a segment also toggles the series in the line chart (bidirectional sync via shared `filterChart` state)

---

### 4.5 Empty / Loading States

**No metrics configured (tab load):**
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│          No metrics available for this resource.        │
│          Check the argocd-metrics-server config.        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
The Metrics tab is hidden entirely when `hasMetrics` is false.

**Individual chart — data not returned:**
```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
│                                               │
│      Metric "http_200_latency" not available  │
│                                               │
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```
Chart area rendered with dashed border, no axes, centered message.

**Loading state:**
```
┌──────────────────────────────────────────────┐
│  Latency                                     │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │  ← shimmer / spinner
└──────────────────────────────────────────────┘
```

---

## 5. API Contract (Current)

### `GET /api/applications/:app/groupkinds/:kind/dashboards`

**Headers (required):**
```
Argocd-Application-Name: <namespace>/<app-name>
Argocd-Project-Name: <project>
```

**Response `200`:**
```jsonc
{
  "tabs": ["GoldenSignal"],
  "intervals": ["1h","2h","6h","12h","24h"],
  "rows": [
    {
      "name": "httplatency",
      "title": "HTTP Latency",
      "tab": "GoldenSignal",
      "graphs": [
        {
          "name": "http_200_latency",
          "title": "Latency",
          "description": "P99 response time for HTTP 200 responses",
          "graphType": "line",        // "line" | "pie" | "anomaly"
          "metricName": "pod_template_hash",
          "thresholds": [],           // optional
          "yAxisUnit": "s",           // optional
          "colorSchemes": []          // optional
        }
      ]
    }
  ]
}
```

**Error `404`:** App or groupKind not found in config
**Error `400`:** Missing/mismatched security headers

---

### `GET /api/applications/:app/groupkinds/:kind/rows/:row/graphs/:graph`

**Query params:**

| Param | Required | Example | Used in PromQL template |
|---|---|---|---|
| `name` | yes | `my-deployment` | `{{.name}}` |
| `namespace` | yes | `production` | `{{.namespace}}` |
| `duration` | yes | `1h` | determines range window |
| `application_name` | yes | `my-app` | security validation |
| `project` | yes | `default` | security validation |
| `uid` | no | `abc-123` | `{{.uid}}` |

**Response `200`:**
```jsonc
{
  "data": [
    {
      "metric": { "pod_template_hash": "abc123" },
      "values": [[1711540800, "0.82"], [1711540860, "0.79"]]
    }
  ],
  "thresholds": []   // same structure, empty if not configured
}
```

**Step size:** fixed at 60 seconds (`time.Minute`)

---

## 6. Configuration Model (Current)

Full JSON schema for `app/config.json` (mounted as ConfigMap):

```
O11yConfig
└── prometheus | wavefront                  ← provider selector (exactly one)
      ├── provider
      │     ├── Name: string
      │     ├── address: string             ← Prometheus base URL
      │     └── tlsConfig?: { ... }
      └── applications[]
            ├── name: string                ← matches ArgoCD app name
            ├── default?: bool              ← fallback for unmatched apps
            └── dashboards[]
                  ├── groupKind: string     ← "deployment" | "pod" | "rollout" | "IngressRoute" | "Ingress"
                  ├── tabs?: string[]
                  ├── intervals?: string[]  ← e.g. ["1h","2h","6h"]
                  └── rows[]
                        ├── name: string    ← URL segment
                        ├── title: string   ← display label
                        ├── tab?: string    ← tab association
                        └── graphs[]
                              ├── name: string
                              ├── title: string
                              ├── description?: string
                              ├── graphType: "line"|"pie"|"anomaly"
                              ├── metricName: string       ← label to group by
                              ├── queryExpression: string  ← Go template PromQL
                              ├── thresholds?: Threshold[]
                              ├── yAxisUnit?: string
                              ├── valueRounding?: int
                              └── colorSchemes?: ColorScheme[]
```

**PromQL template variables available:**

| Variable | Source |
|---|---|
| `{{.name}}` | `name` query param |
| `{{.namespace}}` | `namespace` query param |
| `{{.uid}}` | `uid` query param |
| `{{.application_name}}` | `application_name` query param |

---

## 7. Roadmap — Planned Features

### 7.1 Wavefront Provider GA

**Status:** Alpha — `internal/server/wavefront.go` is functional but untested in production.

**Required work:**
- Integration test suite against a real or mocked Wavefront API
- Document `WAVEFRONT_TOKEN` env var requirement in README + manifests
- Validate `AggregatedResponse` normalization parity with Prometheus provider
- Add `wavefront` section to manifests ConfigMap example

**Config addition:**
```jsonc
{
  "wavefront": {
    "provider": { "address": "https://my-instance.wavefront.com" },
    "applications": [ ... ]
  }
}
```

---

### 7.2 Multiple Metrics Providers

**Motivation:** Large orgs run both Prometheus and Wavefront for different namespaces/clusters.

**Proposed config change:**
```jsonc
{
  "providers": [
    { "type": "prometheus", "name": "prod-prom", "address": "...", "selector": { "namespaces": ["production"] } },
    { "type": "wavefront",  "name": "staging-wf", "address": "...", "selector": { "namespaces": ["staging"]    } }
  ],
  "applications": [ ... ]
}
```

**Impact:** Breaking change to config schema. Requires migration guide and version field.

**Wireframe — provider badge in chart header:**
```
┌─ Latency ──────────────────────── [prometheus:prod-prom] [?] ┐
```

---

### 7.3 Config UI (In-cluster editor)

**Motivation:** Platform engineers currently hand-edit ConfigMap YAML. A UI would reduce errors and speed onboarding.

**Proposed flow:**

```
ArgoCD Settings
  └── Extensions
        └── Metrics Config  ← new section
              ├── Application selector
              ├── Dashboard editor (tabs / rows / graphs)
              └── PromQL tester (run query, preview result)
```

**Wireframe — Config UI skeleton:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Metrics Configuration                                    [+ New App]       │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Application: [ my-app ▼]    GroupKind: [ deployment ▼]                   │
│                                                                             │
│  Tabs: [GoldenSignal] [+ Add tab]                                          │
│                                                                             │
│  ┌─ Row: HTTP Latency ────────────────────────────────────── [Edit] [✕] ─┐ │
│  │  Tab: GoldenSignal                                                     │ │
│  │  Graphs: Latency (line)                                                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│  [+ Add Row]                                                                │
│                                                                             │
│  PromQL Tester: _____________________________________________ [Run]         │
│  Preview: [ chart appears here ]                                           │
│                                                                             │
│                                           [Cancel]  [Save to ConfigMap]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation note:** Requires ArgoCD RBAC role to PATCH the ConfigMap, plus a dedicated backend endpoint (`POST /api/config`).

---

### 7.4 Health Score Summary Bar

**Motivation:** Users want an at-a-glance status without scrolling through all charts.

**Proposed UI — above the tab bar:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Health Summary (last 1h)                                                │
│                                                                          │
│  Latency  ████████░░  82ms    Errors  ████░░░░░░  0.4%   (● healthy)   │
│  Traffic  ██████████  1.2k/s  CPU     ██████░░░░  60%    (▲ elevated)  │
└──────────────────────────────────────────────────────────────────────────┘
```

Each bar is a mini sparkline derived from the already-fetched chart data (no extra API call).

---

### 7.5 Alerting Integration

**Motivation:** Show active Prometheus AlertManager alerts alongside the metric charts.

**Proposed API addition:**
```
GET /api/applications/:app/alerts
Returns: active AlertManager alerts filtered by namespace/app labels
```

**Wireframe — alert badge on chart:**
```
┌─ HTTP Error Rate ──────────────────────────── 🔴 1 active alert ──────┐
```

Clicking the badge expands an alert detail panel inline.

---

### 7.6 Additional Resource Kinds

Currently registered: `Rollout`, `Pod`, `Deployment`, `IngressRoute`, `Ingress`.

**Shipped (2026-03-27):**

| Kind | Dashboard focus | Metrics source |
|---|---|---|
| `IngressRoute` | Latency p50/p95, error rate 4xx/5xx, request rate, open connections | `traefik_router_*` filtered by `@kubernetescrd` |
| `Ingress` | Same as IngressRoute | `traefik_router_*` filtered by `@kubernetes` |

`Deployment` and `Rollout` also gained a **Traefik** tab with service-level metrics (`traefik_service_*`) in addition to the existing Golden Signal tab.

**Proposed additions:**

| Kind | Dashboard focus |
|---|---|
| `StatefulSet` | Pod CPU/Memory + persistent volume I/O |
| `DaemonSet` | Per-node CPU/Memory distribution |
| `Job` / `CronJob` | Completion time, error count, duration histogram |
| `Service` | Request rate, error rate, p99 latency (RED method) |

Each addition requires:
1. Registration in `index.tsx` (one line per kind)
2. Corresponding dashboard rows in the default ConfigMap

---

### 7.7 Security Hardening

**Current gaps:**

| Gap | Risk | Proposed fix |
|---|---|---|
| Self-signed TLS cert | MITM between ArgoCD proxy and metrics server | Support externally issued cert via Secret mount |
| Wavefront token in env var | Visible in Pod spec | Read from K8s Secret ref |
| No rate limiting on metrics queries | Expensive PromQL could overload Prometheus | Add per-app query rate limit in server config |
| `golang.org/x/crypto` CVEs (Dependabot) | ssh/agent panic, unbounded memory | Upgrade to latest `x/crypto` release |
| `golang.org/x/oauth2` CVE (Dependabot) | Improper input validation | Upgrade to latest `x/oauth2` release |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | Dashboard config response: < 100ms p99. Metric query response: < 2s p99 (depends on Prometheus). |
| **Scalability** | Metrics server is stateless; scale horizontally with replicas if needed. |
| **Availability** | Metrics tab degrades gracefully — ArgoCD continues to work if metrics server is down (tab shows empty state). |
| **Compatibility** | Argo CD ≥ 2.6 required. React 16/17 (peer dep). No other ArgoCD extension conflicts. |
| **Bundle size** | UI bundle target: < 500KB gzipped. React/ReactDOM/Moment are externalized (provided by ArgoCD host). |
| **Accessibility** | Chart tooltips accessible via keyboard. Color-blind safe palette for threshold colors. |
| **Observability** | Metrics server should expose its own `/metrics` endpoint (Prometheus format) for self-monitoring. |

---

## 9. Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| 1 | Should `intervals` be global or per-dashboard? Currently per-dashboard, but the duration pill is global in the UI. | Frontend | Open |
| 2 | Should anomaly `medLine`/`highLine` be configurable in the Graph config? Currently hardcoded at 4/7. | Backend | Open |
| 3 | What is the upgrade/migration path when config schema changes (e.g. multi-provider)? Needs versioning strategy. | Platform | Open |
| 4 | Should the metrics server support OAuth2/OIDC passthrough to Prometheus instead of relying on network-level trust? | Security | Open |
| 5 | Is the Wavefront alpha ready to promote given lack of integration tests? | Backend | Blocked on tests |
| 6 | Should charts auto-refresh on a configurable interval without user interaction? | UX | Open |
