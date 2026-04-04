"""Shared state dataclasses and singleton instances."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket

logger = logging.getLogger("eye-tracker")


# ---------------------------------------------------------------------------
# Tracking settings (mutable at runtime)
# ---------------------------------------------------------------------------


@dataclass
class TrackingSettings:
    threshold_strict: int = 5
    threshold_medium: int = 15
    threshold_relaxed: int = 25
    mask_size: int = 250
    stream_fps: int = 30
    jpeg_quality: int = 80


# ---------------------------------------------------------------------------
# Tracking state (per-session)
# ---------------------------------------------------------------------------


class TrackingState:
    """Encapsulates the mutable tracking state that eye_tracker_3d.py
    normally keeps in module-level globals."""

    def __init__(self) -> None:
        self.ray_lines: list = []
        self.model_centers: list = []
        self.max_rays: int = 100
        self.prev_model_center_avg: tuple[int, int] = (320, 240)
        self.max_observed_distance: int = 202
        self.stored_intersections: list = []

    def reset(self) -> None:
        self.__init__()  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Recording state
# ---------------------------------------------------------------------------


@dataclass
class RecordingSession:
    active: bool = False
    start_time: float = 0.0
    rows: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Singleton instances
# ---------------------------------------------------------------------------

settings = TrackingSettings()
tracking_state = TrackingState()
recording = RecordingSession()
ws_clients: set[WebSocket] = set()
latest_tracking: dict = {}


def _create_singletons() -> None:
    """Import and instantiate CameraManager / FrameProcessor.

    Called lazily so that camera.py and processor.py can be imported
    without circular-import issues.
    """
    global camera_mgr, processor  # noqa: PLW0603

    from web.app.camera import CameraManager
    from web.app.processor import FrameProcessor

    camera_mgr = CameraManager()
    processor = FrameProcessor(settings, tracking_state)


# Placeholders so static analysis can see the names exist.
if TYPE_CHECKING:
    from web.app.camera import CameraManager as _CM
    from web.app.processor import FrameProcessor as _FP

camera_mgr: _CM = None  # type: ignore[assignment]
processor: _FP = None  # type: ignore[assignment]

_init_lock = threading.Lock()
_initialized = False


def ensure_initialized() -> None:
    """Thread-safe one-time initialization of camera_mgr / processor."""
    global _initialized  # noqa: PLW0603
    if _initialized:
        return
    with _init_lock:
        if not _initialized:
            _create_singletons()
            _initialized = True


# Eagerly initialize on import.
ensure_initialized()
