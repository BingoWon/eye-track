"""Shared state dataclasses and singleton instances."""

from __future__ import annotations

import logging
from dataclasses import dataclass
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
    max_aspect_ratio: float = 2.5
    mode: str = "classic"  # "classic", "enhanced", or "screen"


# ---------------------------------------------------------------------------
# Tracking state (per-camera)
# ---------------------------------------------------------------------------


class PupilBounds:
    """Axis-aligned bounding ellipse for valid pupil positions."""

    def __init__(self, cx: float, cy: float, rx: float, ry: float) -> None:
        self.cx = cx
        self.cy = cy
        self.rx = rx  # semi-axis X (horizontal)
        self.ry = ry  # semi-axis Y (vertical)

    def contains(self, px: float, py: float) -> bool:
        dx = (px - self.cx) / self.rx if self.rx > 0 else 0
        dy = (py - self.cy) / self.ry if self.ry > 0 else 0
        return (dx * dx + dy * dy) <= 1.0


class TrackingState:
    """Per-camera mutable state."""

    MAX_RAYS = 100

    def __init__(self) -> None:
        self.pupil_bounds: PupilBounds | None = None
        # 3D mode state
        self.ray_lines: list[tuple] = []
        self.eye_center_ewma: tuple[float, float] = (320.0, 240.0)
        self.orig_intersections: list[tuple[int, int]] = []
        self.orig_centers: list[tuple[int, int]] = []
        self.orig_avg: tuple[int, int] = (320, 240)

    def reset(self) -> None:
        self.__init__()  # type: ignore[misc]


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

    def find_by_index(self, camera_index: int) -> Tracker | None:
        """Return existing tracker for this camera index, if any."""
        for t in self.trackers.values():
            if t.camera_index == camera_index:
                return t
        return None

    def add(self, camera_index: int, settings: TrackingSettings) -> Tracker:
        # Return existing tracker if camera already in use
        existing = self.find_by_index(camera_index)
        if existing:
            return existing

        from web.app.camera import CameraManager
        from web.app.processor import FrameProcessor

        cid = f"camera-{self._counter}"
        self._counter += 1
        state = TrackingState()
        cam = CameraManager()
        if not cam.start(camera_index):
            raise RuntimeError(f"Cannot open camera {camera_index}")
        tracker = Tracker(
            id=cid,
            camera_index=camera_index,
            camera=cam,
            processor=FrameProcessor(settings, state),
            state=state,
        )
        self.trackers[cid] = tracker
        logger.info("Tracker %s added (index %d)", cid, camera_index)
        return tracker

    def remove(self, cid: str) -> bool:
        tracker = self.trackers.pop(cid, None)
        if tracker:
            tracker.camera.stop()
            logger.info("Tracker %s removed", cid)
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
ws_clients: set[WebSocket] = set()
latest_tracking: dict = {}
paused: bool = False
