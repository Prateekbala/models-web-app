"""Kubernetes resource watchers for SSE streaming."""

import time
from kubernetes import client, watch
from kubeflow.kubeflow.crud_backend import api, logging
from .. import versions

log = logging.getLogger(__name__)


class InferenceServiceWatcher:
    """Watches InferenceService resources in a namespace."""

    def __init__(self):
        self.watch = watch.Watch()
        self.api_instance = client.CustomObjectsApi()
        self._stop_requested = False

    def watch_namespace(self, namespace, event_callback):
        """
        Watch InferenceServices in a namespace and invoke callback on events.

        Args:
            namespace: Kubernetes namespace to watch
            event_callback: Function to call with (event_type, object) on each event
        """
        gvk = versions.inference_service_gvk()

        while not self._stop_requested:
            try:
                log.info(
                    f"Starting watch for InferenceServices in namespace: {namespace}"
                )

                for event in self.watch.stream(
                    self.api_instance.list_namespaced_custom_object,
                    group=gvk["group"],
                    version=gvk["version"],
                    namespace=namespace,
                    plural=gvk["kind"],
                    timeout_seconds=300,
                ):
                    if self._stop_requested:
                        break

                    event_type = event["type"]
                    obj = event["object"]

                    try:
                        event_callback(event_type, obj)
                    except Exception as e:
                        log.error(f"Error in event callback: {e}")

            except client.exceptions.ApiException as e:
                if self._stop_requested:
                    break
                log.error(f"Watch stream error: {e}")
                self._reconnect_with_backoff()
            except Exception as e:
                if self._stop_requested:
                    break
                log.error(f"Unexpected error in watch stream: {e}")
                self._reconnect_with_backoff()

    def watch_single(self, namespace, name, event_callback):
        """
        Watch a single InferenceService and invoke callback on events.

        Args:
            namespace: Kubernetes namespace
            name: InferenceService name
            event_callback: Function to call with (event_type, object) on each event
        """
        gvk = versions.inference_service_gvk()

        while not self._stop_requested:
            try:
                log.info(f"Starting watch for InferenceService: {namespace}/{name}")

                for event in self.watch.stream(
                    self.api_instance.list_namespaced_custom_object,
                    group=gvk["group"],
                    version=gvk["version"],
                    namespace=namespace,
                    plural=gvk["kind"],
                    field_selector=f"metadata.name={name}",
                    timeout_seconds=300,
                ):
                    if self._stop_requested:
                        break

                    event_type = event["type"]
                    obj = event["object"]

                    try:
                        event_callback(event_type, obj)
                    except Exception as e:
                        log.error(f"Error in event callback: {e}")

            except client.exceptions.ApiException as e:
                if self._stop_requested:
                    break
                log.error(f"Watch stream error: {e}")
                self._reconnect_with_backoff()
            except Exception as e:
                if self._stop_requested:
                    break
                log.error(f"Unexpected error in watch stream: {e}")
                self._reconnect_with_backoff()

    def stop(self):
        """Stop the watch stream."""
        self._stop_requested = True
        try:
            self.watch.stop()
        except Exception as e:
            log.debug(f"Error stopping watch: {e}")

    def _reconnect_with_backoff(self, initial_delay=1, max_delay=32):
        """Reconnect with exponential backoff."""
        delay = initial_delay
        while delay <= max_delay and not self._stop_requested:
            log.info(f"Reconnecting in {delay} seconds...")
            time.sleep(delay)
            delay *= 2
            break


class EventWatcher:
    """Watches Kubernetes Events for InferenceServices."""

    def __init__(self):
        self.watch = watch.Watch()
        self._stop_requested = False

    def watch_events(self, namespace, isvc_name, event_callback):
        """
        Watch Kubernetes Events related to an InferenceService.

        Args:
            namespace: Kubernetes namespace
            isvc_name: InferenceService name
            event_callback: Function to call with (event_type, object) on each event
        """
        while not self._stop_requested:
            try:
                log.info(f"Starting watch for Events in namespace: {namespace}")

                for event in self.watch.stream(
                    api.v1_core.list_namespaced_event,
                    namespace=namespace,
                    field_selector=f"involvedObject.name={isvc_name}",
                    timeout_seconds=300,
                ):
                    if self._stop_requested:
                        break

                    event_type = event["type"]
                    obj = event["object"]

                    try:
                        event_callback(event_type, obj)
                    except Exception as e:
                        log.error(f"Error in event callback: {e}")

            except client.exceptions.ApiException as e:
                if self._stop_requested:
                    break
                log.error(f"Watch stream error: {e}")
                self._reconnect_with_backoff()
            except Exception as e:
                if self._stop_requested:
                    break
                log.error(f"Unexpected error in watch stream: {e}")
                self._reconnect_with_backoff()

    def stop(self):
        """Stop the watch stream."""
        self._stop_requested = True
        try:
            self.watch.stop()
        except Exception as e:
            log.debug(f"Error stopping watch: {e}")

    def _reconnect_with_backoff(self, initial_delay=1, max_delay=32):
        """Reconnect with exponential backoff."""
        delay = initial_delay
        while delay <= max_delay and not self._stop_requested:
            log.info(f"Reconnecting in {delay} seconds...")
            time.sleep(delay)
            delay *= 2
            break
