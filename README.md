# ArgoCD Extension Metrics

The project introduces the ArgoCD extension to enable Metrics on Resource tab.
![](./docs/images/screenshot.png)

This extension is composed of 2 components:
- `argocd-metrics-server` is a backend service that queries and exposes
  Prometheus metrics to the UI extension.
- UI extension that renders graphs based on metrics returned by the
  `argocd-metrics-server`.

## Prerequisites

- Argo CD version 2.6+
- Prometheus
- kubectl with access to the Argo CD cluster
- kustomize (or `kubectl kustomize`)

## Quick Start

### Install in Argo CD (end-to-end)

The steps below install both components in the `argocd` namespace and wire Argo CD to use the extension.

1. Deploy the metrics server (Deployment, Service, and example ConfigMap):

```sh
kubectl apply -n argocd -k ./manifests
```

2. Patch `argocd-server` to download and mount the UI extension bundle:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: argocd-server
spec:
  template:
    spec:
      initContainers:
        - name: extension-metrics
          image: quay.io/argoprojlabs/argocd-extension-installer:v0.0.1
          env:
            - name: EXTENSION_URL
              value: https://github.com/argoproj-labs/argocd-extension-metrics/releases/download/v1.0.0/extension.tar.gz
            - name: EXTENSION_CHECKSUM_URL
              value: https://github.com/argoproj-labs/argocd-extension-metrics/releases/download/v1.0.0/extension_checksums.txt
          volumeMounts:
            - name: extensions
              mountPath: /tmp/extensions/
          securityContext:
            runAsUser: 1000
            allowPrivilegeEscalation: false
      containers:
        - name: argocd-server
          volumeMounts:
            - name: extensions
              mountPath: /tmp/extensions/
      volumes:
        - name: extensions
          emptyDir: {}
```

3. Enable and authorize proxy extensions in Argo CD:

- In `argocd-cmd-params-cm`:
  ```yaml
  server.enable.proxy.extension: "true"
  ```
- In `argocd-rbac-cm`:
  ```yaml
  policy.csv: |-
    p, role:readonly, extensions, invoke, metrics, allow
  ```
- In `argocd-cm`:
  ```yaml
  extension.config: |-
    extensions:
      - name: metrics
        backend:
          services:
            - url: http://argocd-metrics-server.argocd.svc.cluster.local:9003
  ```

4. Restart `argocd-server` and open an Application resource in Argo CD. You should see the **Metrics** tab.

### Verify installation

```sh
kubectl -n argocd get deploy argocd-metrics-server
kubectl -n argocd get svc argocd-metrics-server
kubectl -n argocd logs deploy/argocd-metrics-server --tail=100
```

If the tab does not appear:
- Ensure `server.enable.proxy.extension: "true"` is set in `argocd-cmd-params-cm`.
- Ensure RBAC allows `extensions, invoke, metrics`.
- Ensure `extension.config` points to a reachable service URL.
- Ensure your Prometheus queries in `manifests/configmap.yaml` match available metrics.

### Configuration notes

- Dashboards and graphs are configured in `manifests/configmap.yaml` (`config.json`).
- The shipped configuration is an example and should be adapted to your
  metric names/labels.
- Optional server-level query rate limiting per application can be configured in
  config as:
  ```json
  {
    "server": {
      "queryRateLimitPerAppPerMinute": 60
    }
  }
  ```
- The default in-cluster service URL is:
  `http://argocd-metrics-server.argocd.svc.cluster.local:9003`
- TLS options:
  - By default, with `-enableTLS=true`, the server generates a self-signed cert.
  - To use externally issued certificates (recommended), set:
    `-tls-cert-file=/tls/tls.crt -tls-key-file=/tls/tls.key` and mount a TLS Secret.
- For Wavefront provider, set `WAVEFRONT_TOKEN` from a Kubernetes Secret
  (see `manifests/deployment.yaml` commented example).

### Wavefront example configuration

For Wavefront-backed dashboards, set `wavefront` in `config.json` and inject
`WAVEFRONT_TOKEN` into the server Deployment:

```json
{
  "wavefront": {
    "applications": [
      {
        "name": "default",
        "default": true,
        "dashboards": [
          {
            "groupKind": "deployment",
            "rows": [
              {
                "name": "pod",
                "title": "Pods",
                "graphs": [
                  {
                    "name": "pod_cpu_line",
                    "title": "CPU",
                    "graphType": "line",
                    "metricName": "pod",
                    "queryExpression": "ts(kubernetes.pod.cpu.usage, pod=~\"{{.name}}\")"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "provider": {
      "name": "default",
      "default": true,
      "address": "https://<your-instance>.wavefront.com"
    }
  }
}
```

Kubernetes Secret + env wiring:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: argocd-metrics-server-wavefront
type: Opaque
stringData:
  token: "<wavefront-api-token>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: argocd-metrics-server
spec:
  template:
    spec:
      containers:
        - name: argocd-metrics-server
          env:
            - name: WAVEFRONT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: argocd-metrics-server-wavefront
                  key: token
```

`/home/runner/work/argocd-extension-metrics/argocd-extension-metrics/KiralCreation/argocd-extension-metrics/manifests/configmap.yaml`
includes a `wavefront.config.example.json` key that can be copied into
`config.json` when enabling the Wavefront provider.

## Prioritized Roadmap (P0/P1/P2)

For full details, see `docs/SPEC.md` section **7. Roadmap — Planned Features**.

- **P0 (must-have next):**
  - Security hardening (`7.7`): external TLS cert support, Wavefront token via Secret, query rate limiting.
  - Wavefront Provider GA (`7.1`): integration tests, docs/manifests updates, response parity validation.
- **P1 (high-value next):**
  - Health Score Summary Bar (`7.4`) for at-a-glance status.
  - Alerting Integration (`7.5`) to show active alerts next to charts.
  - Additional Resource Kinds (`7.6`): StatefulSet, DaemonSet, Job/CronJob, Service.
- **P2 (larger/structural):**
  - Multiple Metrics Providers (`7.2`) with schema versioning and migration path.
  - Config UI in-cluster editor (`7.3`) with RBAC and backend config endpoint.

## Contributing

### Local setup

```sh
go test ./...
go build ./...
```

Optional UI build:

```sh
make build-ui
```

Useful commands:
- `make test` / `just test`
- `make build` / `just build`
- `just lint` (requires `golangci-lint`)
- `just run` to run the server locally

[1]: https://github.com/argoproj-labs/argocd-extension-installer
