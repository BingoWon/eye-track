"""Camera management -- background capture thread."""

from __future__ import annotations

import json
import logging
import platform
import subprocess
import threading
import time

import cv2
import numpy as np

from src.pupil_detector import _get_capture_backend, crop_to_aspect_ratio

logger = logging.getLogger("eye-tracker")


def detect_cameras_safe() -> list[dict]:
    """Detect available cameras WITHOUT opening them.

    On macOS, uses system_profiler to list cameras non-intrusively
    (avoids triggering iPhone Continuity Camera beep).
    On other platforms, falls back to OpenCV probe.

    Returns a list of dicts:
        [{"index": 0, "name": "USB Camera", "uniqueId": "0x..."}, ...]
    """
    system = platform.system()

    if system == "Darwin":
        return _detect_cameras_macos()

    # Fallback: OpenCV probe (Windows/Linux) — no unique ID available
    backend = _get_capture_backend()
    cameras = []
    for i in range(10):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            cameras.append({"index": i, "name": f"Camera {i}", "uniqueId": f"index:{i}"})
            cap.release()
    return cameras


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
            unique_id = cam.get("spcamera_unique-id", f"index:{i}")
            cameras.append({"index": i, "name": name, "uniqueId": unique_id})

        return cameras

    except Exception as e:
        logger.warning("Failed to detect cameras via system_profiler: %s", e)
        return []


def resolve_camera_index(unique_id: str) -> int | None:
    """Find the current camera index for a saved unique ID.

    Re-queries system_profiler and matches by unique ID.
    Returns the current index, or None if the camera is not connected.
    """
    cameras = detect_cameras_safe()
    for cam in cameras:
        if cam["uniqueId"] == unique_id:
            return cam["index"]
    return None


class CameraManager:
    """Captures frames from a camera in a background thread and makes
    the latest frame available for processing."""

    def __init__(self) -> None:
        self.cap: cv2.VideoCapture | None = None
        self.camera_index: int = 0
        self.latest_frame: np.ndarray | None = None
        self.frame_lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
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

    def _capture_loop(self) -> None:
        while self._running and self.cap is not None:
            ret, frame = self.cap.read()
            if not ret:
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

    def get_frame(self) -> np.ndarray | None:
        """Return a copy of the latest captured frame, or None."""
        with self.frame_lock:
            if self.latest_frame is not None:
                return self.latest_frame.copy()
        return None

    @property
    def is_running(self) -> bool:
        return self._running and self.cap is not None and self.cap.isOpened()


# ---------------------------------------------------------------------------
# Preview helpers — one CameraManager per index, kept open until closed
# ---------------------------------------------------------------------------

_preview_lock = threading.Lock()
_preview_cams: dict[int, CameraManager] = {}
_preview_failed: set[int] = set()


def get_preview_frame(index: int, rotation: int = 0) -> bytes | None:
    """Get the latest frame from a camera for live preview.

    Each camera index gets its own persistent CameraManager so multiple
    cameras can be previewed simultaneously without reopening hardware.
    Trackers must be stopped before calling this.
    """
    if index in _preview_failed:
        return None

    with _preview_lock:
        cam = _preview_cams.get(index)
        if cam is None:
            cam = CameraManager()
            if not cam.start(index):
                _preview_failed.add(index)
                return None
            _preview_cams[index] = cam
            # Wait for capture thread to grab the first frame
            for _ in range(50):
                if cam.get_frame() is not None:
                    break
                time.sleep(0.02)

    frame = cam.get_frame()
    if frame is None:
        return None

    if rotation == 180:
        frame = cv2.rotate(frame, cv2.ROTATE_180)
    frame = crop_to_aspect_ratio(frame)

    from web.app.state import settings as app_settings

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, app_settings.jpeg_quality])
    if not ok:
        logger.warning("Failed to encode preview frame for camera %d", index)
        return None
    return buf.tobytes()


def close_preview_cameras() -> None:
    """Release all preview cameras."""
    with _preview_lock:
        for cam in _preview_cams.values():
            cam.stop()
        _preview_cams.clear()
        _preview_failed.clear()
