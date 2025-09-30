#!/bin/bash

# KServe Models Web App Helm Chart Installation Script
# This script provides easy installation options for different environments

set -e

CHART_DIR="$(dirname "$0")"
NAMESPACE=""
VALUES_FILE=""
RELEASE_NAME="kserve-models-web-app"
DRY_RUN=false
UPGRADE=false

usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Install KServe Models Web App using Helm

OPTIONS:
    -n, --namespace NAMESPACE    Kubernetes namespace (default: default)
    -f, --values VALUES_FILE     Values file to use
    -r, --release RELEASE_NAME   Helm release name (default: kserve-models-web-app)
    -d, --dry-run               Perform a dry run
    -u, --upgrade               Upgrade existing installation
    -h, --help                  Show this help message

PRESETS:
    --kubeflow                  Install with Kubeflow configuration
    --production                Install with production settings
    --standalone                Install standalone (default configuration)

EXAMPLES:
    # Basic installation
    $0

    # Install in kubeflow namespace with Kubeflow configuration
    $0 --kubeflow -n kubeflow

    # Production installation with custom namespace
    $0 --production -n kserve-production

    # Dry run with custom values
    $0 -f my-values.yaml --dry-run

    # Upgrade existing installation
    $0 --upgrade -n kubeflow --kubeflow
EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -f|--values)
            VALUES_FILE="$2"
            shift 2
            ;;
        -r|--release)
            RELEASE_NAME="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -u|--upgrade)
            UPGRADE=true
            shift
            ;;
        --kubeflow)
            VALUES_FILE="$CHART_DIR/values-kubeflow.yaml"
            NAMESPACE=${NAMESPACE:-kubeflow}
            shift
            ;;
        --production)
            VALUES_FILE="$CHART_DIR/values-production.yaml"
            shift
            ;;
        --standalone)
            # Use default values
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            usage
            exit 1
            ;;
    esac
done

# Validate inputs
if [[ ! -d "$CHART_DIR" ]]; then
    echo "Error: Chart directory not found: $CHART_DIR"
    exit 1
fi

if [[ -n "$VALUES_FILE" && ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file not found: $VALUES_FILE"
    exit 1
fi

# Check if helm is installed
if ! command -v helm &> /dev/null; then
    echo "Error: Helm is not installed. Please install Helm first."
    echo "Visit: https://helm.sh/docs/intro/install/"
    exit 1
fi

# Build helm command
HELM_CMD="helm"

if [[ "$UPGRADE" == "true" ]]; then
    HELM_CMD="$HELM_CMD upgrade"
else
    HELM_CMD="$HELM_CMD install"
fi

HELM_CMD="$HELM_CMD $RELEASE_NAME $CHART_DIR"

if [[ -n "$NAMESPACE" ]]; then
    HELM_CMD="$HELM_CMD --namespace $NAMESPACE --create-namespace"
fi

if [[ -n "$VALUES_FILE" ]]; then
    HELM_CMD="$HELM_CMD --values $VALUES_FILE"
fi

if [[ "$DRY_RUN" == "true" ]]; then
    HELM_CMD="$HELM_CMD --dry-run --debug"
fi

# Print configuration
echo "==============================================="
echo "KServe Models Web App Installation"
echo "==============================================="
echo "Release Name: $RELEASE_NAME"
echo "Namespace: ${NAMESPACE:-default}"
echo "Values File: ${VALUES_FILE:-default values}"
echo "Dry Run: $DRY_RUN"
echo "Upgrade: $UPGRADE"
echo "==============================================="
echo

# Execute helm command
echo "Executing: $HELM_CMD"
echo
eval $HELM_CMD

if [[ "$DRY_RUN" == "false" ]]; then
    echo
    echo "==============================================="
    echo "Installation completed!"
    echo "==============================================="
    
    if [[ "$UPGRADE" == "false" ]]; then
        echo "To check the status:"
        echo "  kubectl get pods -l app.kubernetes.io/instance=$RELEASE_NAME"
        if [[ -n "$NAMESPACE" ]]; then
            echo "  -n $NAMESPACE"
        fi
        echo
        
        echo "To uninstall:"
        echo "  helm uninstall $RELEASE_NAME"
        if [[ -n "$NAMESPACE" ]]; then
            echo "  -n $NAMESPACE"
        fi
    fi
fi