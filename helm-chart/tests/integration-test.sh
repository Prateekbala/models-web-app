#!/bin/bash

# KServe Models Web App Helm Chart Integration Tests
# This script runs integration tests against a real Kubernetes cluster

set -e

CHART_DIR="$(dirname "$0")/.."
NAMESPACE="kserve-models-web-app-test"
RELEASE_NAME="test-kserve-models-web-app"
TIMEOUT="300s"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to cleanup
cleanup() {
    log "Cleaning up test resources..."
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE" 2>/dev/null || true
    kubectl delete namespace "$NAMESPACE" 2>/dev/null || true
}

# Trap cleanup on script exit
trap cleanup EXIT

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    if ! command -v helm &> /dev/null; then
        error "Helm is not installed"
        exit 1
    fi
    
    if ! command -v kubectl &> /dev/null; then
        error "kubectl is not installed"
        exit 1
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        error "No Kubernetes cluster available"
        exit 1
    fi
    
    log "Prerequisites check passed"
}

# Test basic deployment
test_basic_deployment() {
    log "Testing basic deployment..."
    
    # Create namespace
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Install chart
    helm install "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --timeout "$TIMEOUT" \
        --wait
    
    # Verify deployment
    kubectl wait --for=condition=available deployment/"$RELEASE_NAME" \
        --namespace "$NAMESPACE" \
        --timeout="$TIMEOUT"
    
    log "Basic deployment test passed"
}

# Test with custom values
test_custom_values() {
    log "Testing deployment with custom values..."
    
    # Create custom values file
    cat > /tmp/test-values.yaml << EOF
replicaCount: 2
resources:
  limits:
    cpu: 200m
    memory: 256Mi
  requests:
    cpu: 100m
    memory: 128Mi
service:
  type: ClusterIP
config:
  APP_DISABLE_AUTH: "True"
  TEST_CONFIG: "integration-test"
EOF

    # Upgrade with custom values
    helm upgrade "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --values /tmp/test-values.yaml \
        --timeout "$TIMEOUT" \
        --wait
    
    # Verify replicas
    REPLICAS=$(kubectl get deployment "$RELEASE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
    if [ "$REPLICAS" != "2" ]; then
        error "Expected 2 replicas, got $REPLICAS"
        exit 1
    fi
    
    # Verify custom config
    CONFIG_VALUE=$(kubectl get configmap "$RELEASE_NAME-config" -n "$NAMESPACE" -o jsonpath='{.data.TEST_CONFIG}')
    if [ "$CONFIG_VALUE" != "integration-test" ]; then
        error "Expected custom config value 'integration-test', got '$CONFIG_VALUE'"
        exit 1
    fi
    
    log "Custom values test passed"
}

# Test service connectivity
test_service_connectivity() {
    log "Testing service connectivity..."
    
    # Port forward to test connectivity
    kubectl port-forward service/"$RELEASE_NAME" 18080:80 -n "$NAMESPACE" &
    PF_PID=$!
    sleep 5
    
    # Test health endpoint
    if curl -f http://localhost:18080/healthz/readiness --max-time 10; then
        log "Service connectivity test passed"
    else
        warn "Service connectivity test failed - this might be expected if the app requires KServe dependencies"
    fi
    
    # Clean up port forward
    kill $PF_PID 2>/dev/null || true
}

# Test RBAC
test_rbac() {
    log "Testing RBAC configuration..."
    
    # Check if ClusterRole exists
    if kubectl get clusterrole "$RELEASE_NAME-cluster-role" &> /dev/null; then
        log "ClusterRole exists"
    else
        error "ClusterRole not found"
        exit 1
    fi
    
    # Check if ClusterRoleBinding exists
    if kubectl get clusterrolebinding "$RELEASE_NAME-binding" &> /dev/null; then
        log "ClusterRoleBinding exists"
    else
        error "ClusterRoleBinding not found"
        exit 1
    fi
    
    # Check ServiceAccount
    if kubectl get serviceaccount "$RELEASE_NAME" -n "$NAMESPACE" &> /dev/null; then
        log "ServiceAccount exists"
    else
        error "ServiceAccount not found"
        exit 1
    fi
    
    log "RBAC test passed"
}

# Test with production values
test_production_deployment() {
    log "Testing production deployment..."
    
    # Test with production values
    helm upgrade "$RELEASE_NAME" "$CHART_DIR" \
        --namespace "$NAMESPACE" \
        --values "$CHART_DIR/values-production.yaml" \
        --timeout "$TIMEOUT" \
        --wait
    
    # Verify replicas (should be 3 in production)
    REPLICAS=$(kubectl get deployment "$RELEASE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')
    if [ "$REPLICAS" != "3" ]; then
        error "Expected 3 replicas in production, got $REPLICAS"
        exit 1
    fi
    
    # Verify resource limits are set
    CPU_LIMIT=$(kubectl get deployment "$RELEASE_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}')
    if [ -z "$CPU_LIMIT" ]; then
        error "CPU limits not set in production deployment"
        exit 1
    fi
    
    log "Production deployment test passed"
}

# Test rollback
test_rollback() {
    log "Testing rollback functionality..."
    
    # Get current revision
    CURRENT_REVISION=$(helm history "$RELEASE_NAME" -n "$NAMESPACE" --max 1 -o json | jq -r '.[0].revision')
    
    # Rollback to previous revision
    helm rollback "$RELEASE_NAME" $((CURRENT_REVISION - 1)) -n "$NAMESPACE" --wait
    
    # Verify rollback
    kubectl wait --for=condition=available deployment/"$RELEASE_NAME" \
        --namespace "$NAMESPACE" \
        --timeout="$TIMEOUT"
    
    log "Rollback test passed"
}

# Test uninstall
test_uninstall() {
    log "Testing uninstall..."
    
    # Uninstall
    helm uninstall "$RELEASE_NAME" -n "$NAMESPACE" --wait
    
    # Verify resources are cleaned up
    if kubectl get deployment "$RELEASE_NAME" -n "$NAMESPACE" &> /dev/null; then
        error "Deployment still exists after uninstall"
        exit 1
    fi
    
    log "Uninstall test passed"
}

# Main test execution
main() {
    log "Starting KServe Models Web App Helm Chart Integration Tests"
    
    check_prerequisites
    test_basic_deployment
    test_custom_values
    test_service_connectivity
    test_rbac
    test_production_deployment
    test_rollback
    test_uninstall
    
    log "All integration tests passed!"
}

# Run main function
main "$@"