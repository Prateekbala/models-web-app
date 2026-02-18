"""SSE module for streaming Kubernetes resource updates."""

from flask import Blueprint

bp = Blueprint("sse", __name__)

from . import routes
