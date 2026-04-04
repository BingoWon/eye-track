"""Shared state dataclasses and singleton instances."""

from __future__ import annotations

import logging
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
    stream_fps: int = 120
    jpeg_quality: int = 80
    min_confidence: float = 0.3
    eye_center_alpha: float = 0.02


# ---------------------------------------------------------------------------
# Tracking state (per-session)
# ---------------------------------------------------------------------------


class TrackingState:
    """Mutable tracking state for the eye center EWMA estimator."""

    def __init__(self) -> None:
        self.prev_ellipse: tuple | None = None  # previous valid ellipse
        self.eye_center: tuple[float, float] | None = None  # EWMA estimate
        self.max_observed_distance: int = 202

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
paused: bool = False


from web.app.camera import CameraManager  # noqa: E402
from web.app.processor import FrameProcessor  # noqa: E402

camera_mgr = CameraManager()
processor = FrameProcessor(settings, tracking_state)
