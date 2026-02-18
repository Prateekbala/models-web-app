"""GET routes of the backend."""

import os
from flask import jsonify

from kubeflow.kubeflow.crud_backend import api, logging

from . import bp

log = logging.getLogger(__name__)


@bp.route("/api/config", methods=["GET"])
def get_config():
    """Handle retrieval of application configuration."""
    try:
        config = {
            "grafanaPrefix": os.environ.get("GRAFANA_PREFIX", "/grafana"),
            "grafanaCpuMemoryDb": os.environ.get(
                "GRAFANA_CPU_MEMORY_DB",
                "db/knative-serving-revision-cpu-and-memory-usage",
            ),
            "grafanaHttpRequestsDb": os.environ.get(
                "GRAFANA_HTTP_REQUESTS_DB", "db/knative-serving-revision-http-requests"
            ),
            "sseEnabled": os.environ.get("SSE_ENABLED", "true").lower() == "true",
        }

        log.info("Configuration requested: %s", config)
        return jsonify(config)
    except Exception as e:
        log.error("Error retrieving configuration: %s", str(e))
        return api.error_response("message", "Failed to retrieve configuration"), 500


@bp.route("/api/config/namespaces", methods=["GET"])
def get_namespaces():
    """Handle retrieval of available namespaces with optional filtering."""
    try:
        all_namespaces = api.list_namespaces()
        all_namespace_names = [ns.metadata.name for ns in all_namespaces.items]

        allowed_namespaces_env = os.environ.get("ALLOWED_NAMESPACES", "").strip()

        if not allowed_namespaces_env:
            return api.success_response("namespaces", all_namespace_names)

        allowed_namespaces = [
            ns.strip() for ns in allowed_namespaces_env.split(",") if ns.strip()
        ]

        if not allowed_namespaces:
            return api.success_response("namespaces", all_namespace_names)

        valid_allowed_namespaces = [
            ns for ns in allowed_namespaces if ns in all_namespace_names
        ]

        if not valid_allowed_namespaces:
            log.warning(
                "None of the ALLOWED_NAMESPACES exist in cluster. Falling back to all namespaces."
            )
            return api.success_response("namespaces", all_namespace_names)

        invalid_namespaces = [
            ns for ns in allowed_namespaces if ns not in all_namespace_names
        ]
        if invalid_namespaces:
            log.warning(
                "Invalid namespaces in ALLOWED_NAMESPACES (ignored): %s",
                invalid_namespaces,
            )

        return api.success_response("namespaces", valid_allowed_namespaces)

    except Exception as e:
        log.error("Error retrieving namespaces: %s", str(e))
        return api.failed_response("message", "Failed to retrieve namespaces"), 500


@bp.route("/", methods=["GET"])
def index():
    """Serve the frontend index.html file."""
    import os
    from flask import send_from_directory, render_template_string

    static_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + "/static"

    # Try to load index.html from static directory
    try:
        with open(os.path.join(static_dir, "index.html"), "r") as f:
            return f.read()
    except FileNotFoundError:
        # Fallback: return a message if index.html not found
        return """
        <html>
          <body style='font-family: sans-serif; text-align: center; margin-top: 50px'>
            <h1>Models Web App</h1>
            <p>Frontend is loading...</p>
            <p>API Status: <a href='/api/config'>Check API Config</a></p>
            <p>API is available at <code>/api/</code></p>
          </body>
        </html>
        """
