# KServe Models Web App Helm Chart

This Helm chart deploys the KServe Models Web App, a web interface for managing KServe InferenceServices.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.0+
- KServe installed in the cluster
- (Optional) Istio service mesh for advanced routing and security

## Installation

### Basic Installation

```bash
# Add the chart repository (when published)
helm repo add kserve https://kserve.github.io/models-web-app

# Install the chart
helm install kserve-models-web-app kserve/kserve-models-web-app
```

### Local Installation

```bash
# From the helm-chart directory
helm install kserve-models-web-app ./helm-chart
```

### Installation in Kubeflow Environment

For deployment within a Kubeflow environment with Istio:

```bash
helm install kserve-models-web-app ./helm-chart \
  --namespace kubeflow \
  --values ./helm-chart/values-kubeflow.yaml
```

## Configuration

The following table lists the configurable parameters of the KServe Models Web App chart and their default values.

### General Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas | `1` |
| `image.repository` | Image repository | `ghcr.io/kserve/models-web-app` |
| `image.tag` | Image tag | `""` (uses chart appVersion) |
| `image.pullPolicy` | Image pull policy | `Always` |
| `nameOverride` | Override the name of the chart | `""` |
| `fullnameOverride` | Override the fullname of the chart | `""` |

### Service Account Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `serviceAccount.create` | Create service account | `true` |
| `serviceAccount.annotations` | Service account annotations | `{}` |
| `serviceAccount.name` | Service account name | `""` |

### RBAC Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `rbac.create` | Create RBAC resources | `true` |

### Service Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `service.type` | Service type | `ClusterIP` |
| `service.port` | Service port | `80` |
| `service.nodePort` | NodePort (only if type is NodePort) | `""` |

### Application Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.APP_DISABLE_AUTH` | Disable authentication | `"True"` |
| `config.GRAFANA_PREFIX` | Grafana URL prefix | `"/grafana"` |
| `config.GRAFANA_CPU_MEMORY_DB` | Grafana CPU/Memory database | `"db/knative-serving-revision-cpu-and-memory-usage"` |
| `config.GRAFANA_HTTP_REQUESTS_DB` | Grafana HTTP requests database | `"db/knative-serving-revision-http-requests"` |

### Istio Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `istio.enabled` | Enable Istio resources | `false` |
| `istio.virtualService.gateways` | Istio gateways | `["knative-serving/knative-ingress-gateway"]` |
| `istio.virtualService.hosts` | Istio hosts | `["*"]` |
| `istio.virtualService.uriPrefix` | URI prefix for routing | `"/kserve-endpoints/"` |
| `istio.virtualService.rewrite.enabled` | Enable URI rewrite | `true` |
| `istio.virtualService.rewrite.uri` | Rewrite URI | `"/"` |
| `istio.authorizationPolicy.enabled` | Enable authorization policy | `false` |
| `istio.authorizationPolicy.action` | Authorization action | `ALLOW` |

### Health Probes

| Parameter | Description | Default |
|-----------|-------------|---------|
| `probes.liveness.path` | Liveness probe path | `/healthz/liveness` |
| `probes.liveness.initialDelaySeconds` | Initial delay for liveness probe | `0` |
| `probes.liveness.periodSeconds` | Period for liveness probe | `10` |
| `probes.readiness.path` | Readiness probe path | `/healthz/readiness` |
| `probes.readiness.initialDelaySeconds` | Initial delay for readiness probe | `0` |
| `probes.readiness.periodSeconds` | Period for readiness probe | `10` |

### Security Context

| Parameter | Description | Default |
|-----------|-------------|---------|
| `podSecurityContext.runAsNonRoot` | Run as non-root user | `true` |
| `securityContext.allowPrivilegeEscalation` | Allow privilege escalation | `false` |
| `securityContext.runAsUser` | User ID to run as | `1000` |

## Usage Examples

### Standalone Deployment

```bash
# Basic deployment with default settings
helm install my-kserve-web-app ./helm-chart

# With custom configuration
helm install my-kserve-web-app ./helm-chart \
  --set replicaCount=2 \
  --set service.type=NodePort \
  --set service.nodePort=30080
```

### Kubeflow Integration

```bash
# Deploy in kubeflow namespace with Istio
helm install kserve-models-web-app ./helm-chart \
  --namespace kubeflow \
  --create-namespace \
  --values ./helm-chart/values-kubeflow.yaml
```

### With Custom Values File

Create a `my-values.yaml` file:

```yaml
replicaCount: 2

config:
  APP_DISABLE_AUTH: "False"
  CUSTOM_CONFIG: "custom-value"

istio:
  enabled: true
  virtualService:
    hosts:
      - "my-domain.com"

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 250m
    memory: 256Mi
```

Then install:

```bash
helm install my-release ./helm-chart -f my-values.yaml
```

## Accessing the Application

### Port Forward (for testing)

```bash
kubectl port-forward service/kserve-models-web-app 8080:80
```

Then access http://localhost:8080

### Through Istio (in Kubeflow)

If deployed with Istio in Kubeflow, the application will be available at:
`https://your-kubeflow-domain/kserve-endpoints/`

## Uninstallation

```bash
helm uninstall kserve-models-web-app
```

## Contributing

1. Make changes to the chart
2. Update the version in `Chart.yaml`
3. Test the chart with different configurations
4. Submit a pull request

## Troubleshooting

### Common Issues

1. **RBAC Errors**: Ensure RBAC is enabled and the service account has proper permissions
2. **Image Pull Errors**: Check image repository and tag settings
3. **Istio Issues**: Verify Istio is installed and configured correctly
4. **Authorization Issues**: Check authorization policy settings when using Istio

### Debug Commands

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=kserve-models-web-app

# Check service
kubectl get svc kserve-models-web-app

# Check logs
kubectl logs -l app.kubernetes.io/name=kserve-models-web-app

# Check configmap
kubectl get configmap kserve-models-web-app-config -o yaml
```

## License

This chart is licensed under the Apache License 2.0.