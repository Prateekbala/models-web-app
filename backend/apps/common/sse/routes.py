"""SSE routes for streaming Kubernetes resource updates."""

import json
import queue
import time
from flask import Response, stream_with_context, request
from kubeflow.kubeflow.crud_backend import api, logging
from . import bp
from .manager import get_manager
from .. import versions
from .. import utils

log = logging.getLogger(__name__)


def _format_sse_message(event_type, data):
    """Format data as SSE message."""
    return f"event: {event_type.lower()}\ndata: {json.dumps(data)}\n\n"


def _send_heartbeat():
    """Send SSE heartbeat comment to keep connection alive."""
    return ": heartbeat\n\n"


@bp.route("/api/sse/namespaces/<namespace>/inferenceservices")
def stream_inference_services(namespace):
    """Stream InferenceService updates for a namespace via SSE."""

    def event_stream():
        client_queue = queue.Queue(maxsize=100)
        manager = get_manager()
        watch_key = f"ns:{namespace}"

        try:
            initial_data = api.list_custom_rsrc(
                **versions.inference_service_gvk(), namespace=namespace
            )

            yield _format_sse_message(
                "initial", {"type": "INITIAL", "items": initial_data["items"]}
            )

            manager.register_namespace_watch(namespace, client_queue)

            last_heartbeat = time.time()
            heartbeat_interval = 30

            while True:
                try:
                    event_data = client_queue.get(timeout=1)
                    yield _format_sse_message(event_data["type"].lower(), event_data)
                    last_heartbeat = time.time()
                except queue.Empty:
                    if time.time() - last_heartbeat > heartbeat_interval:
                        yield _send_heartbeat()
                        last_heartbeat = time.time()
                    continue

        except GeneratorExit:
            log.info(f"Client disconnected from namespace watch: {namespace}")
            manager.unregister_client(watch_key, client_queue)
        except Exception as e:
            log.error(f"Error in SSE stream: {e}")
            manager.unregister_client(watch_key, client_queue)
            yield _format_sse_message("error", {"type": "ERROR", "message": str(e)})

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@bp.route("/api/sse/namespaces/<namespace>/inferenceservices/<name>")
def stream_inference_service(namespace, name):
    """Stream updates for a specific InferenceService via SSE."""

    def event_stream():
        client_queue = queue.Queue(maxsize=100)
        manager = get_manager()
        watch_key = f"isvc:{namespace}/{name}"

        try:
            initial_data = api.get_custom_rsrc(
                **versions.inference_service_gvk(), namespace=namespace, name=name
            )

            yield _format_sse_message(
                "initial", {"type": "INITIAL", "object": initial_data}
            )

            manager.register_single_watch(namespace, name, client_queue)

            last_heartbeat = time.time()
            heartbeat_interval = 30

            while True:
                try:
                    event_data = client_queue.get(timeout=1)
                    yield _format_sse_message(event_data["type"].lower(), event_data)
                    last_heartbeat = time.time()
                except queue.Empty:
                    if time.time() - last_heartbeat > heartbeat_interval:
                        yield _send_heartbeat()
                        last_heartbeat = time.time()
                    continue

        except GeneratorExit:
            log.info(f"Client disconnected from single watch: {namespace}/{name}")
            manager.unregister_client(watch_key, client_queue)
        except Exception as e:
            log.error(f"Error in SSE stream: {e}")
            manager.unregister_client(watch_key, client_queue)
            yield _format_sse_message("error", {"type": "ERROR", "message": str(e)})

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@bp.route("/api/sse/namespaces/<namespace>/inferenceservices/<name>/events")
def stream_inference_service_events(namespace, name):
    """Stream Kubernetes Events for an InferenceService via SSE."""

    def event_stream():
        client_queue = queue.Queue(maxsize=100)
        manager = get_manager()
        watch_key = f"events:{namespace}/{name}"

        try:
            field_selector = api.events_field_selector("InferenceService", name)
            initial_events = api.events.list_events(namespace, field_selector).items

            yield _format_sse_message(
                "initial", {"type": "INITIAL", "items": api.serialize(initial_events)}
            )

            manager.register_event_watch(namespace, name, client_queue)

            last_heartbeat = time.time()
            heartbeat_interval = 30

            while True:
                try:
                    event_data = client_queue.get(timeout=1)
                    yield _format_sse_message(event_data["type"].lower(), event_data)
                    last_heartbeat = time.time()
                except queue.Empty:
                    if time.time() - last_heartbeat > heartbeat_interval:
                        yield _send_heartbeat()
                        last_heartbeat = time.time()
                    continue

        except GeneratorExit:
            log.info(f"Client disconnected from event watch: {namespace}/{name}")
            manager.unregister_client(watch_key, client_queue)
        except Exception as e:
            log.error(f"Error in SSE stream: {e}")
            manager.unregister_client(watch_key, client_queue)
            yield _format_sse_message("error", {"type": "ERROR", "message": str(e)})

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@bp.route("/api/sse/namespaces/<namespace>/inferenceservices/<name>/logs")
def stream_inference_service_logs(namespace, name):
    """Stream pod logs for an InferenceService via SSE."""
    import gevent

    def event_stream():
        try:
            # Get InferenceService first
            svc = api.get_custom_rsrc(
                **versions.inference_service_gvk(), namespace=namespace, name=name
            )

            # Get component filters from query parameters
            components = request.args.getlist("component")

            last_heartbeat = time.time()
            heartbeat_interval = 30
            poll_interval = 3  # Poll logs every 3 seconds

            while True:
                try:
                    # Fetch logs using existing logic
                    logs_data = _get_logs_for_service(svc, components)

                    # Send logs update
                    yield _format_sse_message(
                        "update", {"type": "UPDATE", "logs": logs_data}
                    )

                    last_heartbeat = time.time()
                    gevent.sleep(poll_interval)

                except Exception as e:
                    log.error(f"Error fetching logs: {e}")
                    # Continue trying, don't break the stream
                    if time.time() - last_heartbeat > heartbeat_interval:
                        yield _send_heartbeat()
                        last_heartbeat = time.time()
                    gevent.sleep(poll_interval)

        except GeneratorExit:
            log.info(f"Client disconnected from logs stream: {namespace}/{name}")
        except Exception as e:
            log.error(f"Error in logs SSE stream: {e}")
            yield _format_sse_message("error", {"type": "ERROR", "message": str(e)})

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


def _get_logs_for_service(svc, components):
    """Get logs for an InferenceService. Extracted from get.py logic."""
    namespace = svc["metadata"]["namespace"]

    # Check deployment mode to determine how to get logs
    deployment_mode = utils.get_deployment_mode(svc)

    if deployment_mode == "ModelMesh":
        # For ModelMesh, get logs from modelmesh-serving deployment
        component_pods_dict = utils.get_modelmesh_pods(svc, components)
    elif deployment_mode == "Standard":
        component_pods_dict = utils.get_standard_inference_service_pods(svc, components)
    else:
        # Serverless mode
        component_pods_dict = utils.get_inference_service_pods(svc, components)

    if len(component_pods_dict.keys()) == 0:
        return {}

    resp = {}
    for component, pods in component_pods_dict.items():
        if component not in resp:
            resp[component] = []

        for pod in pods:
            try:
                logs = api.get_pod_logs(namespace, pod, "kserve-container", auth=False)
                resp[component].append({"podName": pod, "logs": logs.split("\n")})
            except Exception as e:
                log.error(f"Error getting logs for pod {pod}: {e}")
                resp[component].append(
                    {"podName": pod, "logs": [f"Error retrieving logs: {str(e)}"]}
                )

    return resp
