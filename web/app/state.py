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
# Tracking state (per-tracker)
# ---------------------------------------------------------------------------


class TrackingState:
    """Per-tracker mutable state for EWMA eye center."""

    def __init__(self) -> None:
        self.prev_ellipse: tuple | None = None
        self.eye_center: tuple[float, float] | None = None
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
# Tracker: one camera + processing pipeline
# ---------------------------------------------------------------------------


@dataclass
class Tracker:
    """One camera + processing pipeline."""

    id: str
    camera_index: int
    camera: "CameraManager"  # noqa: F821
    processor: "FrameProcessor"  # noqa: F821
    state: TrackingState


# ---------------------------------------------------------------------------
# TrackerRegistry: manages N simultaneous trackers
# ---------------------------------------------------------------------------


class TrackerRegistry:
    """Manages N simultaneous trackers."""

    def __init__(self) -> None:
        self.trackers: dict[str, Tracker] = {}
        self._counter: int = 0

    def add(self, camera_index: int, settings: TrackingSettings) -> Tracker:
        from web.app.camera import CameraManager
        from web.app.processor import FrameProcessor

        tid = f"tracker-{self._counter}"
        self._counter += 1
        state = TrackingState()
        cam = CameraManager()
        if not cam.start(camera_index):
            raise RuntimeError(f"Cannot open camera {camera_index}")
        tracker = Tracker(
            id=tid,
            camera_index=camera_index,
            camera=cam,
            processor=FrameProcessor(settings, state),
            state=state,
        )
        self.trackers[tid] = tracker
        logger.info("Tracker %s added (camera %d)", tid, camera_index)
        return tracker

    def remove(self, tid: str) -> bool:
        tracker = self.trackers.pop(tid, None)
        if tracker:
            tracker.camera.stop()
            logger.info("Tracker %s removed", tid)
            return True
        return False

    def stop_all(self) -> None:
        for t in list(self.trackers.values()):
            t.camera.stop()
        self.trackers.clear()


# ---------------------------------------------------------------------------
# Singleton instances
# ---------------------------------------------------------------------------

settings = TrackingSettings()
registry = TrackerRegistry()
recording = RecordingSession()
ws_clients: set[WebSocket] = set()
latest_tracking: dict = {}
paused: bool = False
