"""Camera management -- background capture thread."""

from __future__ import annotations

import json
import logging
import platform
import subprocess
import threading
import time
from typing import Optional

import cv2
import numpy as np

from src.pupil_detector import _get_capture_backend, crop_to_aspect_ratio

logger = logging.getLogger("eye-tracker")


def detect_cameras_safe() -> list[dict]:
    """Detect available cameras WITHOUT opening them.

    On macOS, uses system_profiler to list cameras non-intrusively
    (avoids triggering iPhone Continuity Camera beep).
    On other platforms, falls back to OpenCV probe.

    Returns a list of dicts: [{"index": 0, "name": "FaceTime HD Camera"}, ...]
    """
    system = platform.system()

    if system == "Darwin":
        return _detect_cameras_macos()

    # Fallback: OpenCV probe (Windows/Linux)
    from src.eye_tracker_3d import detect_cameras as _opencv_detect

    indices = _opencv_detect()
    return [{"index": i, "name": f"Camera {i}"} for i in indices]


def _detect_cameras_macos() -> list[dict]:
    """Use system_profiler to list cameras on macOS without opening them."""
    try:
        result = subprocess.run(
            ["system_profiler", "SPCameraDataType", "-json"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode != 0:
            logger.warning("system_profiler failed: %s", result.stderr)
            return []

        data = json.loads(result.stdout)
        cameras_raw = data.get("SPCameraDataType", [])

        cameras = []
        for i, cam in enumerate(cameras_raw):
            name = cam.get("_name", f"Camera {i}")
            cameras.append({"index": i, "name": name})

        return cameras

    except Exception as e:
        logger.warning("Failed to detect cameras via system_profiler: %s", e)
        return []


class CameraManager:
    """Captures frames from a camera in a background thread and makes
    the latest frame available for processing."""

    def __init__(self) -> None:
        self.cap: Optional[cv2.VideoCapture] = None
        self.camera_index: int = 0
        self.latest_frame: Optional[np.ndarray] = None
        self.frame_lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self.camera_fps: float = 0.0
        self._frame_count: int = 0
        self._fps_timer: float = 0.0

    def start(self, camera_index: int = 0) -> bool:
        """Open the camera and start the capture thread."""
        self.stop()

        backend = _get_capture_backend()
        cap = cv2.VideoCapture(camera_index, backend)

        if platform.system() != "Darwin":
            cap.set(cv2.CAP_PROP_EXPOSURE, -6)

        if not cap.isOpened():
            logger.error("Could not open camera %d", camera_index)
            return False

        self.cap = cap
        self.camera_index = camera_index
        self._running = True
        self._frame_count = 0
        self._fps_timer = time.monotonic()
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        logger.info("Camera %d started", camera_index)
        return True

    def stop(self) -> None:
        """Stop the capture thread and release the camera."""
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None
        if self.cap is not None:
            self.cap.release()
            self.cap = None
        self.latest_frame = None
        logger.info("Camera stopped")

    def _capture_loop(self) -> None:
        while self._running and self.cap is not None:
            ret, frame = self.cap.read()
            if not ret:
                logger.warning("Failed to read frame from camera")
                time.sleep(0.01)
                continue

            frame = cv2.flip(frame, 0)

            with self.frame_lock:
                self.latest_frame = frame

            self._frame_count += 1
            now = time.monotonic()
            elapsed = now - self._fps_timer
            if elapsed >= 1.0:
                self.camera_fps = self._frame_count / elapsed
                self._frame_count = 0
                self._fps_timer = now

    def get_frame(self) -> Optional[np.ndarray]:
        """Return a copy of the latest captured frame, or None."""
        with self.frame_lock:
            if self.latest_frame is not None:
                return self.latest_frame.copy()
        return None

    @property
    def is_running(self) -> bool:
        return self._running and self.cap is not None and self.cap.isOpened()


# ---------------------------------------------------------------------------
# Preview helpers
# ---------------------------------------------------------------------------

_preview_lock = threading.Lock()


def capture_preview(index: int) -> Optional[bytes]:
    """Capture a single preview frame from a camera (blocking, thread-safe)."""
    with _preview_lock:
        backend = _get_capture_backend()
        cap = cv2.VideoCapture(index, backend)
        if not cap.isOpened():
            return None

        # Grab a few frames to let auto-exposure settle
        for _ in range(5):
            cap.read()
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return None

        frame = cv2.flip(frame, 0)
        frame = crop_to_aspect_ratio(frame)

        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return None

        return buf.tobytes()
