"""
FastAPI WebSocket backend for real-time eye tracking.

Streams processed camera frames with tracking overlays to web clients
via WebSocket, and exposes REST endpoints for configuration and control.

Usage:
    uv run uvicorn web.server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import base64
import csv
import io
import json
import logging
import platform
import sys
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Path setup so we can import from src/
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from src.eye_tracker_3d import (
    compute_average_intersection,
    detect_cameras,
    update_and_average_point,
)
from src.pupil_detector import (
    _get_capture_backend,
    apply_binary_threshold,
    check_contour_pixels,
    check_ellipse_goodness,
    crop_to_aspect_ratio,
    filter_contours_by_area_and_return_largest,
    get_darkest_area,
    mask_outside_square,
    optimize_contours_by_angle,
)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("eye-tracker-server")

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
# Tracking state (per-session, isolated from the global state in
# eye_tracker_3d.py so we never call cv2.imshow or write files)
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
# Camera manager — runs in a background thread
# ---------------------------------------------------------------------------


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
# Frame processor — headless pipeline (no cv2.imshow, no file writes)
# ---------------------------------------------------------------------------


class FrameProcessor:
    """Processes a single frame through the detection + 3D gaze pipeline
    and returns structured tracking data plus an annotated image."""

    def __init__(self, settings: TrackingSettings, state: TrackingState) -> None:
        self.settings = settings
        self.state = state
        self._stream_fps_actual: float = 0.0
        self._fps_count: int = 0
        self._fps_timer: float = time.monotonic()

    # -- public API --

    def process(self, raw_frame: np.ndarray) -> tuple[np.ndarray, dict]:
        """Run the full pipeline on *raw_frame*.

        Returns (annotated_frame, tracking_dict).
        """
        frame = crop_to_aspect_ratio(raw_frame)
        darkest_point = get_darkest_area(frame)
        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        darkest_pixel_value = int(gray_frame[darkest_point[1], darkest_point[0]])

        s = self.settings
        thresh_strict = apply_binary_threshold(gray_frame, darkest_pixel_value, s.threshold_strict)
        thresh_strict = mask_outside_square(thresh_strict, darkest_point, s.mask_size)

        thresh_medium = apply_binary_threshold(gray_frame, darkest_pixel_value, s.threshold_medium)
        thresh_medium = mask_outside_square(thresh_medium, darkest_point, s.mask_size)

        thresh_relaxed = apply_binary_threshold(
            gray_frame, darkest_pixel_value, s.threshold_relaxed
        )
        thresh_relaxed = mask_outside_square(thresh_relaxed, darkest_point, s.mask_size)

        ellipse, confidence = self._detect_pupil(
            thresh_strict, thresh_medium, thresh_relaxed, frame, gray_frame
        )

        # Compute 2D eye center from ray intersections
        model_center_average = self._compute_eye_center(frame, ellipse)

        # Build tracking result and draw overlays
        tracking = self._build_tracking(frame, ellipse, model_center_average, confidence)

        # Update FPS counter
        self._fps_count += 1
        now = time.monotonic()
        elapsed = now - self._fps_timer
        if elapsed >= 1.0:
            self._stream_fps_actual = self._fps_count / elapsed
            self._fps_count = 0
            self._fps_timer = now
        tracking["fps"] = round(self._stream_fps_actual, 1)

        return frame, tracking

    # -- internal helpers --

    def _detect_pupil(
        self,
        thresh_strict: np.ndarray,
        thresh_medium: np.ndarray,
        thresh_relaxed: np.ndarray,
        frame: np.ndarray,
        gray_frame: np.ndarray,
    ) -> tuple[Optional[tuple], float]:
        """Cascaded thresholding pipeline. Returns (ellipse, confidence)."""
        kernel = np.ones((5, 5), np.uint8)
        image_array = [thresh_relaxed, thresh_medium, thresh_strict]

        best_contours: list = []
        best_goodness: float = 0.0

        for img in image_array:
            dilated = cv2.dilate(img, kernel, iterations=2)
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            reduced = filter_contours_by_area_and_return_largest(contours, 1000, 3)

            if len(reduced) > 0 and len(reduced[0]) > 5:
                current_goodness = check_ellipse_goodness(dilated, reduced[0], False)
                total_pixels = check_contour_pixels(reduced[0], dilated.shape, False)
                final_goodness = (
                    current_goodness[0] * total_pixels[0] * total_pixels[0] * total_pixels[1]
                )
                if final_goodness > 0 and final_goodness > best_goodness:
                    best_goodness = final_goodness
                    best_contours = reduced

        # Optimize contours
        optimized = [optimize_contours_by_angle(best_contours, gray_frame)]

        if optimized and not isinstance(optimized[0], list) and len(optimized[0]) > 5:
            ellipse = cv2.fitEllipse(optimized[0])
            # Confidence: normalize goodness to 0-1 range (heuristic)
            confidence = min(1.0, best_goodness / 1e8) if best_goodness > 0 else 0.0
            return ellipse, confidence

        return None, 0.0

    def _compute_eye_center(self, frame: np.ndarray, ellipse: Optional[tuple]) -> tuple[int, int]:
        """Update ray lines and compute the running-average eye center."""
        st = self.state

        if ellipse is not None:
            st.ray_lines.append(ellipse)
            if len(st.ray_lines) > st.max_rays:
                st.ray_lines = st.ray_lines[-st.max_rays :]

        model_center_average = (320, 240)

        # We need to temporarily patch the module-level stored_intersections
        # in eye_tracker_3d so compute_average_intersection works.
        import src.eye_tracker_3d as et3d

        old_stored = et3d.stored_intersections
        et3d.stored_intersections = st.stored_intersections

        try:
            model_center = compute_average_intersection(frame, st.ray_lines, 5, 1500, 5)
            # Sync back
            st.stored_intersections = et3d.stored_intersections
        finally:
            et3d.stored_intersections = old_stored

        if model_center is not None:
            model_center_average = update_and_average_point(st.model_centers, model_center, 200)

        if model_center_average[0] == 320:
            model_center_average = st.prev_model_center_avg
        if model_center_average[0] != 0:
            st.prev_model_center_avg = model_center_average

        return model_center_average

    def _build_tracking(
        self,
        frame: np.ndarray,
        ellipse: Optional[tuple],
        eye_center: tuple[int, int],
        confidence: float,
    ) -> dict:
        """Draw overlays on *frame* (in-place) and return the tracking dict."""
        tracking: dict = {
            "pupil": None,
            "eyeCenter": list(eye_center),
            "gaze": None,
            "fps": 0.0,
            "confidence": round(confidence, 3),
            "timestamp": time.time(),
        }

        # Eye boundary circle (blue)
        cv2.circle(frame, eye_center, self.state.max_observed_distance, (255, 50, 50), 2)
        # Eye center dot (cyan)
        cv2.circle(frame, eye_center, 8, (255, 255, 0), -1)

        if ellipse is None:
            return tracking

        center_xy = (int(ellipse[0][0]), int(ellipse[0][1]))
        axes = (ellipse[1][0], ellipse[1][1])
        angle = ellipse[2]

        tracking["pupil"] = {
            "center": list(center_xy),
            "axes": [round(axes[0], 2), round(axes[1], 2)],
            "angle": round(angle, 2),
        }

        # Pupil ellipse (yellow)
        cv2.ellipse(frame, ellipse, (20, 255, 255), 2)

        # Gaze line from eye center through pupil center (cyan to green gradient)
        cx, cy = center_xy
        ex, ey = eye_center
        cv2.line(frame, eye_center, (cx, cy), (255, 150, 50), 2)

        dx = cx - ex
        dy = cy - ey
        extended_x = int(ex + 2 * dx)
        extended_y = int(ey + 2 * dy)
        cv2.line(frame, (cx, cy), (extended_x, extended_y), (200, 255, 0), 3)

        # 3D gaze computation (reuses math, does NOT write to file)
        center_3d, direction_3d = _compute_gaze_vector_no_file(cx, cy, ex, ey)

        if center_3d is not None and direction_3d is not None:
            tracking["gaze"] = {
                "origin": [round(float(v), 4) for v in center_3d],
                "direction": [round(float(v), 4) for v in direction_3d],
            }

            # Overlay gaze text
            origin_text = f"Origin: ({center_3d[0]:.2f}, {center_3d[1]:.2f}, {center_3d[2]:.2f})"
            dir_text = f"Dir: ({direction_3d[0]:.2f}, {direction_3d[1]:.2f}, {direction_3d[2]:.2f})"
            h = frame.shape[0]
            cv2.putText(
                frame, origin_text, (12, h - 38), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3
            )
            cv2.putText(frame, dir_text, (12, h - 13), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(
                frame, origin_text, (10, h - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2
            )
            cv2.putText(
                frame, dir_text, (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2
            )

        return tracking


# ---------------------------------------------------------------------------
# Gaze vector computation WITHOUT file I/O
# ---------------------------------------------------------------------------


def _compute_gaze_vector_no_file(
    x: int,
    y: int,
    center_x: int,
    center_y: int,
    screen_width: int = 640,
    screen_height: int = 480,
) -> tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """Same math as eye_tracker_3d.compute_gaze_vector but returns values
    directly instead of writing to gaze_vector.txt."""
    viewport_width = screen_width
    viewport_height = screen_height

    fov_y_deg = 45.0
    aspect_ratio = viewport_width / viewport_height
    far_clip = 100.0

    camera_position = np.array([0.0, 0.0, 3.0])

    fov_y_rad = np.radians(fov_y_deg)
    half_height_far = np.tan(fov_y_rad / 2) * far_clip
    half_width_far = half_height_far * aspect_ratio

    ndc_x = (2.0 * x) / viewport_width - 1.0
    ndc_y = 1.0 - (2.0 * y) / viewport_height

    far_x = ndc_x * half_width_far
    far_y = ndc_y * half_height_far
    far_z = camera_position[2] - far_clip
    far_point = np.array([far_x, far_y, far_z])

    ray_origin = camera_position
    ray_direction = far_point - camera_position
    ray_direction /= np.linalg.norm(ray_direction)
    ray_direction = -ray_direction

    inner_radius = 1.0 / 1.05
    sphere_offset_x = (center_x / screen_width) * 2.0 - 1.0
    sphere_offset_y = 1.0 - (center_y / screen_height) * 2.0
    sphere_center = np.array([sphere_offset_x * 1.5, sphere_offset_y * 1.5, 0.0])

    origin = ray_origin
    direction = -ray_direction
    L = origin - sphere_center

    a = np.dot(direction, direction)
    b = 2 * np.dot(direction, L)
    c = np.dot(L, L) - inner_radius**2

    discriminant = b**2 - 4 * a * c
    if discriminant < 0:
        t = -np.dot(direction, L) / np.dot(direction, direction)
        intersection_point = origin + t * direction
        intersection_local = intersection_point - sphere_center
        norm = np.linalg.norm(intersection_local)
        if norm < 1e-10:
            return None, None
        target_direction = intersection_local / norm
    else:
        sqrt_disc = np.sqrt(discriminant)
        t1 = (-b - sqrt_disc) / (2 * a)
        t2 = (-b + sqrt_disc) / (2 * a)

        t = None
        if t1 > 0 and t2 > 0:
            t = min(t1, t2)
        elif t1 > 0:
            t = t1
        elif t2 > 0:
            t = t2
        if t is None:
            return None, None

    # Recompute final intersection
    sqrt_disc = np.sqrt(max(discriminant, 0))
    t1 = (-b - sqrt_disc) / (2 * a)
    t2 = (-b + sqrt_disc) / (2 * a)

    t = None
    if t1 > 0 and t2 > 0:
        t = min(t1, t2)
    elif t1 > 0:
        t = t1
    elif t2 > 0:
        t = t2
    if t is None:
        return None, None

    intersection_point = origin + t * direction
    intersection_local = intersection_point - sphere_center
    norm = np.linalg.norm(intersection_local)
    if norm < 1e-10:
        return None, None
    target_direction = intersection_local / norm

    circle_local_center = np.array([0.0, 0.0, inner_radius])
    circle_local_center /= np.linalg.norm(circle_local_center)

    rotation_axis = np.cross(circle_local_center, target_direction)
    rotation_axis_norm = np.linalg.norm(rotation_axis)
    if rotation_axis_norm < 1e-6:
        return sphere_center, circle_local_center

    rotation_axis /= rotation_axis_norm
    dot = np.clip(np.dot(circle_local_center, target_direction), -1.0, 1.0)
    angle_rad = np.arccos(dot)

    cos_a = np.cos(angle_rad)
    sin_a = np.sin(angle_rad)
    t_ = 1 - cos_a
    x_, y_, z_ = rotation_axis

    rotation_matrix = np.array(
        [
            [t_ * x_ * x_ + cos_a, t_ * x_ * y_ - sin_a * z_, t_ * x_ * z_ + sin_a * y_],
            [t_ * x_ * y_ + sin_a * z_, t_ * y_ * y_ + cos_a, t_ * y_ * z_ - sin_a * x_],
            [t_ * x_ * z_ - sin_a * y_, t_ * y_ * z_ + sin_a * x_, t_ * z_ * z_ + cos_a],
        ]
    )

    gaze_local = np.array([0.0, 0.0, inner_radius])
    gaze_rotated = rotation_matrix @ gaze_local
    norm = np.linalg.norm(gaze_rotated)
    if norm < 1e-10:
        return None, None
    gaze_rotated /= norm

    return sphere_center, gaze_rotated


# ---------------------------------------------------------------------------
# Application singletons
# ---------------------------------------------------------------------------

settings = TrackingSettings()
tracking_state = TrackingState()
camera_mgr = CameraManager()
processor = FrameProcessor(settings, tracking_state)
recording = RecordingSession()
ws_clients: set[WebSocket] = set()
_latest_tracking: dict = {}


# ---------------------------------------------------------------------------
# WebSocket broadcaster — runs as an asyncio task
# ---------------------------------------------------------------------------


async def _broadcast_loop() -> None:
    """Grab the latest camera frame, process it, and broadcast to all
    connected WebSocket clients at the configured stream FPS."""
    global _latest_tracking

    logger.info("Broadcast loop started")
    while True:
        try:
            target_interval = 1.0 / max(1, settings.stream_fps)
            t0 = time.monotonic()

            frame = camera_mgr.get_frame()
            if frame is not None and ws_clients:
                annotated, tracking = processor.process(frame)

                # Encode JPEG
                encode_params = [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality]
                ok, buf = cv2.imencode(".jpg", annotated, encode_params)
                if ok:
                    b64_image = base64.b64encode(buf.tobytes()).decode("ascii")

                    message = json.dumps(
                        {
                            "type": "frame",
                            "image": b64_image,
                            "tracking": tracking,
                        }
                    )

                    _latest_tracking = tracking

                    # Record if active
                    if recording.active:
                        recording.rows.append(tracking)

                    # Send to all clients; drop slow ones
                    dead: list[WebSocket] = []
                    for ws in list(ws_clients):
                        try:
                            await ws.send_text(message)
                        except Exception:
                            dead.append(ws)
                    for ws in dead:
                        ws_clients.discard(ws)

            elapsed = time.monotonic() - t0
            sleep_time = max(0.0, target_interval - elapsed)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("Broadcast loop cancelled")
            return
        except Exception:
            logger.exception("Error in broadcast loop")
            await asyncio.sleep(0.1)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: detect cameras but do NOT auto-open — let the user choose
    cameras = detect_cameras()
    logger.info("Detected cameras: %s (waiting for user selection)", cameras)

    broadcast_task = asyncio.create_task(_broadcast_loop())

    yield

    # Shutdown
    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass
    camera_mgr.stop()
    logger.info("Server shut down cleanly")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Eye Tracker WebSocket Server",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.add(ws)
    logger.info("WebSocket client connected (%d total)", len(ws_clients))

    # Send initial status
    try:
        await ws.send_text(
            json.dumps(
                {
                    "type": "status",
                    "cameraIndex": camera_mgr.camera_index,
                    "cameraRunning": camera_mgr.is_running,
                    "cameraFps": round(camera_mgr.camera_fps, 1),
                    "streamFps": settings.stream_fps,
                }
            )
        )
    except Exception:
        ws_clients.discard(ws)
        return

    try:
        # Keep connection alive; listen for client messages (unused for now)
        while True:
            data = await ws.receive_text()
            # Clients can send ping / settings; currently a no-op placeholder.
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("WebSocket error", exc_info=True)
    finally:
        ws_clients.discard(ws)
        logger.info("WebSocket client disconnected (%d remaining)", len(ws_clients))


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.get("/api/cameras")
async def list_cameras() -> JSONResponse:
    """List available camera indices."""
    cameras = detect_cameras()
    return JSONResponse(
        {
            "cameras": cameras,
            "active": camera_mgr.camera_index if camera_mgr.is_running else None,
        }
    )


@app.get("/api/cameras/{index}/preview")
async def camera_preview(index: int) -> StreamingResponse:
    """Capture a single frame from the specified camera and return as JPEG.
    This briefly opens the camera, grabs a frame, and releases it."""
    backend = _get_capture_backend()
    cap = cv2.VideoCapture(index, backend)
    if not cap.isOpened():
        return JSONResponse({"error": f"Cannot open camera {index}"}, status_code=400)

    # Grab a few frames to let auto-exposure settle
    for _ in range(5):
        cap.read()
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        return JSONResponse({"error": "Failed to capture frame"}, status_code=500)

    frame = cv2.flip(frame, 0)
    frame = crop_to_aspect_ratio(frame)

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return JSONResponse({"error": "Failed to encode frame"}, status_code=500)

    return StreamingResponse(
        io.BytesIO(buf.tobytes()),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/api/status")
async def get_status() -> JSONResponse:
    """Return current tracking status."""
    return JSONResponse(
        {
            "cameraIndex": camera_mgr.camera_index,
            "cameraRunning": camera_mgr.is_running,
            "cameraFps": round(camera_mgr.camera_fps, 1),
            "streamFps": settings.stream_fps,
            "connectedClients": len(ws_clients),
            "recording": recording.active,
            "recordingRows": len(recording.rows),
            "latestTracking": _latest_tracking or None,
        }
    )


@app.post("/api/settings")
async def update_settings(body: dict) -> JSONResponse:
    """Update tracking parameters at runtime."""
    mapping = {
        "thresholdStrict": "threshold_strict",
        "thresholdMedium": "threshold_medium",
        "thresholdRelaxed": "threshold_relaxed",
        "maskSize": "mask_size",
        "streamFps": "stream_fps",
        "jpegQuality": "jpeg_quality",
    }
    updated = {}
    for key, attr in mapping.items():
        if key in body:
            val = int(body[key])
            setattr(settings, attr, val)
            updated[key] = val

    if not updated:
        return JSONResponse({"error": "No valid settings provided"}, status_code=400)

    logger.info("Settings updated: %s", updated)
    return JSONResponse({"updated": updated})


@app.post("/api/camera/{index}")
async def switch_camera(index: int) -> JSONResponse:
    """Switch to a different camera by index."""
    ok = camera_mgr.start(index)
    if not ok:
        return JSONResponse({"error": f"Could not open camera {index}"}, status_code=400)
    # Reset tracking state for the new camera
    tracking_state.reset()
    return JSONResponse({"cameraIndex": index, "running": True})


@app.post("/api/recording/start")
async def recording_start() -> JSONResponse:
    """Start recording tracking data."""
    if recording.active:
        return JSONResponse({"error": "Already recording"}, status_code=400)
    recording.active = True
    recording.start_time = time.time()
    recording.rows = []
    logger.info("Recording started")
    return JSONResponse({"status": "recording", "startTime": recording.start_time})


@app.post("/api/recording/stop")
async def recording_stop() -> JSONResponse:
    """Stop recording tracking data."""
    if not recording.active:
        return JSONResponse({"error": "Not recording"}, status_code=400)
    recording.active = False
    logger.info("Recording stopped — %d rows captured", len(recording.rows))
    return JSONResponse(
        {
            "status": "stopped",
            "rows": len(recording.rows),
            "durationSeconds": round(time.time() - recording.start_time, 2),
        }
    )


@app.get("/api/recording/download")
async def recording_download() -> StreamingResponse:
    """Download recorded tracking data as CSV."""
    if not recording.rows:
        return JSONResponse({"error": "No recorded data"}, status_code=404)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "timestamp",
            "fps",
            "confidence",
            "pupil_cx",
            "pupil_cy",
            "pupil_ax",
            "pupil_ay",
            "pupil_angle",
            "eye_center_x",
            "eye_center_y",
            "gaze_ox",
            "gaze_oy",
            "gaze_oz",
            "gaze_dx",
            "gaze_dy",
            "gaze_dz",
        ]
    )

    for row in recording.rows:
        pupil = row.get("pupil") or {}
        gaze = row.get("gaze") or {}
        p_center = pupil.get("center", [None, None])
        p_axes = pupil.get("axes", [None, None])
        g_origin = gaze.get("origin", [None, None, None])
        g_dir = gaze.get("direction", [None, None, None])
        ec = row.get("eyeCenter", [None, None])

        writer.writerow(
            [
                row.get("timestamp"),
                row.get("fps"),
                row.get("confidence"),
                p_center[0],
                p_center[1],
                p_axes[0],
                p_axes[1],
                pupil.get("angle"),
                ec[0],
                ec[1],
                g_origin[0],
                g_origin[1],
                g_origin[2],
                g_dir[0],
                g_dir[1],
                g_dir[2],
            ]
        )

    content = buf.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=eye_tracking_recording.csv"},
    )


# ---------------------------------------------------------------------------
# Serve frontend static files (must be last so it doesn't shadow API routes)
# ---------------------------------------------------------------------------

_frontend_dist = PROJECT_ROOT / "web" / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
    logger.info("Serving frontend from %s", _frontend_dist)
else:
    logger.info("Frontend dist directory not found at %s — skipping static mount", _frontend_dist)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "web.server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info",
    )
