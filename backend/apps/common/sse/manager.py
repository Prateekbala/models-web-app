"""SSE connection manager for coordinating watch streams and client connections."""

import json
import threading
from collections import defaultdict
from kubeflow.kubeflow.crud_backend import logging
from .watchers import InferenceServiceWatcher, EventWatcher

log = logging.getLogger(__name__)


class SSEConnectionManager:
    """Manages SSE connections and Kubernetes watch streams."""

    def __init__(self):
        self._namespace_watchers = {}
        self._single_watchers = {}
        self._event_watchers = {}
        self._client_queues = defaultdict(list)
        self._locks = defaultdict(threading.Lock)

    def register_namespace_watch(self, namespace, client_queue):
        """
        Register a client for namespace-scoped InferenceService watch.

        Args:
            namespace: Kubernetes namespace to watch
            client_queue: Queue to send events to client
        """
        watch_key = f"ns:{namespace}"

        with self._locks[watch_key]:
            self._client_queues[watch_key].append(client_queue)

            if watch_key not in self._namespace_watchers:
                watcher = InferenceServiceWatcher()
                self._namespace_watchers[watch_key] = watcher

                def event_callback(event_type, obj):
                    self._broadcast_event(watch_key, event_type, obj)

                thread = threading.Thread(
                    target=watcher.watch_namespace,
                    args=(namespace, event_callback),
                    daemon=True,
                )
                thread.start()
                log.info(f"Started namespace watcher for: {namespace}")

    def register_single_watch(self, namespace, name, client_queue):
        """
        Register a client for single InferenceService watch.

        Args:
            namespace: Kubernetes namespace
            name: InferenceService name
            client_queue: Queue to send events to client
        """
        watch_key = f"isvc:{namespace}/{name}"

        with self._locks[watch_key]:
            self._client_queues[watch_key].append(client_queue)

            if watch_key not in self._single_watchers:
                watcher = InferenceServiceWatcher()
                self._single_watchers[watch_key] = watcher

                def event_callback(event_type, obj):
                    self._broadcast_event(watch_key, event_type, obj)

                thread = threading.Thread(
                    target=watcher.watch_single,
                    args=(namespace, name, event_callback),
                    daemon=True,
                )
                thread.start()
                log.info(f"Started single watcher for: {namespace}/{name}")

    def register_event_watch(self, namespace, isvc_name, client_queue):
        """
        Register a client for Kubernetes Event watch.

        Args:
            namespace: Kubernetes namespace
            isvc_name: InferenceService name
            client_queue: Queue to send events to client
        """
        watch_key = f"events:{namespace}/{isvc_name}"

        with self._locks[watch_key]:
            self._client_queues[watch_key].append(client_queue)

            if watch_key not in self._event_watchers:
                watcher = EventWatcher()
                self._event_watchers[watch_key] = watcher

                def event_callback(event_type, obj):
                    self._broadcast_event(watch_key, event_type, obj)

                thread = threading.Thread(
                    target=watcher.watch_events,
                    args=(namespace, isvc_name, event_callback),
                    daemon=True,
                )
                thread.start()
                log.info(f"Started event watcher for: {namespace}/{isvc_name}")

    def unregister_client(self, watch_key, client_queue):
        """
        Unregister a client from a watch stream.

        Args:
            watch_key: Watch identifier
            client_queue: Client queue to remove
        """
        with self._locks[watch_key]:
            if client_queue in self._client_queues[watch_key]:
                self._client_queues[watch_key].remove(client_queue)

            if len(self._client_queues[watch_key]) == 0:
                self._stop_watcher(watch_key)

    def _broadcast_event(self, watch_key, event_type, obj):
        """
        Broadcast an event to all clients watching this resource.

        Args:
            watch_key: Watch identifier
            event_type: Event type (ADDED, MODIFIED, DELETED)
            obj: Kubernetes object
        """
        event_data = {"type": event_type, "object": obj}

        with self._locks[watch_key]:
            dead_queues = []
            for queue in self._client_queues[watch_key]:
                try:
                    queue.put(event_data)
                except Exception as e:
                    log.error(f"Error sending event to client: {e}")
                    dead_queues.append(queue)

            for queue in dead_queues:
                self._client_queues[watch_key].remove(queue)

    def _stop_watcher(self, watch_key):
        """Stop a watcher when no clients are connected."""
        if watch_key.startswith("ns:"):
            watcher = self._namespace_watchers.pop(watch_key, None)
        elif watch_key.startswith("isvc:"):
            watcher = self._single_watchers.pop(watch_key, None)
        elif watch_key.startswith("events:"):
            watcher = self._event_watchers.pop(watch_key, None)
        else:
            watcher = None

        if watcher:
            watcher.stop()
            log.info(f"Stopped watcher: {watch_key}")


_manager_instance = None
_manager_lock = threading.Lock()


def get_manager():
    """Get singleton SSE connection manager instance."""
    global _manager_instance

    if _manager_instance is None:
        with _manager_lock:
            if _manager_instance is None:
                _manager_instance = SSEConnectionManager()

    return _manager_instance
