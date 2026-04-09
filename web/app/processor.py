"""Frame processing pipeline -- pupil detection and optional 3D gaze."""

from __future__ import annotations

import logging
import random
import time

import cv2
import numpy as np

from src.pupil_detector import (
    apply_binary_threshold,
    check_contour_pixels,
    check_ellipse_goodness,
    crop_to_aspect_ratio,
    filter_contours_by_area_and_return_largest,
    get_darkest_area,
    mask_outside_square,
    optimize_contours_by_angle,
)
from web.app.state import TrackingSettings, TrackingState

logger = logging.getLogger("eye-tracker")

# Frame defaults (must match crop_to_aspect_ratio output)
DEFAULT_EYE_CENTER = (320, 240)
DEFAULT_EYE_CENTER_F = (320.0, 240.0)


class FrameProcessor:
    """Processes a single frame through the pupil detection pipeline
    and returns structured tracking data plus an annotated image."""

    # BGR colors for overlays
    COLOR_CLASSIC = (255, 50, 50)  # blue
    COLOR_ENHANCED = (200, 50, 200)  # purple
    COLOR_REJECTED = (0, 0, 255)  # red
    COLOR_PUPIL = (20, 255, 255)  # yellow
    COLOR_GAZE_EXT = (200, 255, 0)  # green

    # Eye center algorithm constants
    EYE_RADIUS = 202
    MIN_ANGLE_DIFF = 2.0  # degrees
    RAY_SAMPLE_COUNT = 5
    ALPHA_WARMUP = 0.05
    ALPHA_STABLE = 0.002  # ~500 frame effective window at 120fps
    WARMUP_RAYS = 50

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

        raw_ellipse, raw_conf = self._detect_pupil(
            thresh_strict, thresh_medium, thresh_relaxed
        )
        ellipse, confidence = self._validate(raw_ellipse, raw_conf)

        # Always compute both eye centers
        st = self.state
        if ellipse is not None:
            st.ray_lines.append(ellipse)
            if len(st.ray_lines) > st.MAX_RAYS:
                st.ray_lines = st.ray_lines[-st.MAX_RAYS :]
            self._compute_eye_center_ewma(frame)
            self._compute_eye_center_original(frame)

        # Gaze from active algorithm
        gaze = None
        if ellipse is not None and self.settings.mode != "screen":
            active = (
                st.orig_avg
                if self.settings.mode == "classic"
                else (int(st.eye_center_ewma[0]), int(st.eye_center_ewma[1]))
            )
            gaze = self._compute_gaze(ellipse, active)

        # Rejected ellipse for red overlay
        rejected = raw_ellipse if ellipse is None and raw_ellipse is not None else None
        tracking = self._build_tracking(frame, ellipse, rejected, gaze, confidence)

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
    ) -> tuple[tuple | None, float]:
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
                current_goodness = check_ellipse_goodness(dilated, reduced[0])
                total_pixels = check_contour_pixels(reduced[0], dilated.shape)
                final_goodness = (
                    current_goodness[0] * total_pixels[0] * total_pixels[0] * total_pixels[1]
                )
                if final_goodness > 0 and final_goodness > best_goodness:
                    best_goodness = final_goodness
                    best_contours = reduced

        # Optimize contours
        optimized = [optimize_contours_by_angle(best_contours)]

        if optimized and not isinstance(optimized[0], list) and len(optimized[0]) > 5:
            ellipse = cv2.fitEllipse(optimized[0])
            confidence = min(1.0, best_goodness / 1e5) if best_goodness > 0 else 0.0
            return ellipse, confidence

        return None, 0.0

    def _validate(
        self, ellipse: tuple | None, confidence: float
    ) -> tuple[tuple | None, float]:
        """Reject blinks and out-of-range detections."""
        if ellipse is None:
            return None, 0.0
        if confidence < self.settings.min_confidence:
            return None, 0.0
        axes = ellipse[1]
        minor, major = min(axes), max(axes)
        if minor > 0 and major / minor > self.settings.max_aspect_ratio:
            return None, 0.0
        bounds = self.state.pupil_bounds
        if bounds is not None:
            px, py = float(ellipse[0][0]), float(ellipse[0][1])
            if not bounds.contains(px, py):
                return None, 0.0
        return ellipse, confidence

    def _build_tracking(
        self,
        frame: np.ndarray,
        ellipse: tuple | None,
        rejected_ellipse: tuple | None,
        gaze: dict | None,
        confidence: float,
    ) -> dict:
        """Draw all overlays and return tracking dict."""
        st = self.state
        orig = st.orig_avg
        ewma = (int(st.eye_center_ewma[0]), int(st.eye_center_ewma[1]))

        tracking: dict = {
            "pupil": None,
            "eyeCenterClassic": list(orig) if orig != DEFAULT_EYE_CENTER else None,
            "eyeCenterEnhanced": list(ewma) if ewma != DEFAULT_EYE_CENTER else None,
            "gaze": gaze,
            "fps": 0.0,
            "confidence": round(confidence, 3),
            "timestamp": time.time(),
        }

        # Eye center overlays (circle + dot + label)
        if orig != DEFAULT_EYE_CENTER:
            self._draw_eye_center(frame, orig, self.COLOR_CLASSIC, "Classic", label_dx=-55)
        if ewma != DEFAULT_EYE_CENTER:
            self._draw_eye_center(frame, ewma, self.COLOR_ENHANCED, "Enhanced", label_dx=10)

        # Pupil bounds (green dashed ellipse)
        self._draw_bounds_ellipse(frame)

        # Rejected pupil (red ellipse)
        if rejected_ellipse is not None:
            cv2.ellipse(frame, rejected_ellipse, self.COLOR_REJECTED, 2)

        if ellipse is None:
            return tracking

        # Valid pupil (yellow ellipse)
        center_xy = (int(ellipse[0][0]), int(ellipse[0][1]))
        tracking["pupil"] = {
            "center": list(center_xy),
            "axes": [round(ellipse[1][0], 2), round(ellipse[1][1], 2)],
            "angle": round(ellipse[2], 2),
        }
        cv2.ellipse(frame, ellipse, self.COLOR_PUPIL, 2)

        # Gaze line
        mode = self.settings.mode
        if mode != "screen":
            active = orig if mode == "classic" else ewma
            color = self.COLOR_CLASSIC if mode == "classic" else self.COLOR_ENHANCED
            if active != DEFAULT_EYE_CENTER:
                cv2.line(frame, active, center_xy, color, 2)
                dx = center_xy[0] - active[0]
                dy = center_xy[1] - active[1]
                ext = (int(active[0] + 2 * dx), int(active[1] + 2 * dy))
                cv2.line(frame, center_xy, ext, self.COLOR_GAZE_EXT, 3)

        return tracking

    def _draw_eye_center(
        self,
        frame: np.ndarray,
        center: tuple[int, int],
        color: tuple[int, int, int],
        label: str,
        label_dx: int,
    ) -> None:
        """Draw eye center circle, dot, and label."""
        cv2.circle(frame, center, self.EYE_RADIUS, color, 2)
        cv2.circle(frame, center, 6, color, -1)
        cv2.putText(
            frame,
            label,
            (center[0] + label_dx, center[1] - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            color,
            1,
        )

    # -- eye center algorithms --

    def _compute_eye_center_ewma(self, frame: np.ndarray) -> None:
        """Estimate 2D eye center via random 5-ray sampling + EWMA."""
        st = self.state
        h, w = frame.shape[:2]

        if len(st.ray_lines) < 2:
            return

        sample_n = min(self.RAY_SAMPLE_COUNT, len(st.ray_lines))
        selected = random.sample(st.ray_lines, sample_n)

        frame_intersections: list[tuple[float, float]] = []
        for i in range(len(selected) - 1):
            e1, e2 = selected[i], selected[i + 1]
            if abs(e1[2] - e2[2]) < self.MIN_ANGLE_DIFF:
                continue
            ix = self._intersect_ellipse_normals(e1, e2)
            if ix and 0 <= ix[0] < w and 0 <= ix[1] < h:
                frame_intersections.append(ix)

        if not frame_intersections:
            return

        avg_x = sum(p[0] for p in frame_intersections) / len(frame_intersections)
        avg_y = sum(p[1] for p in frame_intersections) / len(frame_intersections)

        a = self.ALPHA_WARMUP if len(st.ray_lines) < self.WARMUP_RAYS else self.ALPHA_STABLE

        if st.eye_center_ewma == DEFAULT_EYE_CENTER_F:
            st.eye_center_ewma = (avg_x, avg_y)
        else:
            st.eye_center_ewma = (
                a * avg_x + (1 - a) * st.eye_center_ewma[0],
                a * avg_y + (1 - a) * st.eye_center_ewma[1],
            )

    def _compute_eye_center_original(self, frame: np.ndarray) -> None:
        """Original Orlosky algorithm: random 5-ray sampling + 1500-intersection
        buffer + 200-window average."""
        st = self.state
        h, w = frame.shape[:2]
        if len(st.ray_lines) < 2:
            return
        selected = random.sample(st.ray_lines, min(self.RAY_SAMPLE_COUNT, len(st.ray_lines)))
        for i in range(len(selected) - 1):
            e1, e2 = selected[i], selected[i + 1]
            if abs(e1[2] - e2[2]) < self.MIN_ANGLE_DIFF:
                continue
            ix = self._intersect_ellipse_normals(e1, e2)
            if ix and 0 <= ix[0] < w and 0 <= ix[1] < h:
                st.orig_intersections.append((int(ix[0]), int(ix[1])))
        if len(st.orig_intersections) > 1500:
            st.orig_intersections = st.orig_intersections[-1500:]
        if not st.orig_intersections:
            return
        avg_x = int(np.mean([p[0] for p in st.orig_intersections]))
        avg_y = int(np.mean([p[1] for p in st.orig_intersections]))
        st.orig_centers.append((avg_x, avg_y))
        if len(st.orig_centers) > 200:
            st.orig_centers.pop(0)
        fx = int(np.mean([p[0] for p in st.orig_centers]))
        fy = int(np.mean([p[1] for p in st.orig_centers]))
        if (fx, fy) != (w // 2, h // 2):
            st.orig_avg = (fx, fy)

    @staticmethod
    def _intersect_ellipse_normals(e1: tuple, e2: tuple) -> tuple[float, float] | None:
        """Compute the intersection of two ellipses' minor-axis normals."""
        (cx1, cy1), (_, minor1), angle1 = e1
        (cx2, cy2), (_, minor2), angle2 = e2

        a1 = np.deg2rad(angle1)
        a2 = np.deg2rad(angle2)

        dx1 = (minor1 / 2) * np.cos(a1)
        dy1 = (minor1 / 2) * np.sin(a1)
        dx2 = (minor2 / 2) * np.cos(a2)
        dy2 = (minor2 / 2) * np.sin(a2)

        det = dx1 * (-dy2) - dy1 * (-dx2)
        if abs(det) < 1e-10:
            return None

        t1 = ((cx2 - cx1) * (-dy2) - (cy2 - cy1) * (-dx2)) / det
        return (cx1 + t1 * dx1, cy1 + t1 * dy1)

    def _compute_gaze(self, ellipse: tuple, eye_center: tuple[int, int]) -> dict | None:
        """Compute 3D gaze vector from pupil and eye center."""
        cx, cy = int(ellipse[0][0]), int(ellipse[0][1])
        ex, ey = eye_center
        center_3d, direction_3d = _compute_gaze_vector_no_file(cx, cy, ex, ey)
        if center_3d is not None and direction_3d is not None:
            return {
                "origin": [round(float(v), 4) for v in center_3d],
                "direction": [round(float(v), 4) for v in direction_3d],
            }
        return None

    def _draw_bounds_ellipse(self, frame: np.ndarray) -> None:
        """Draw the pupil bounds ellipse (green dashed) if set."""
        bounds = self.state.pupil_bounds
        if bounds is not None:
            segments = 60
            for i in range(0, segments, 2):
                a1 = 2 * np.pi * i / segments
                a2 = 2 * np.pi * (i + 1) / segments
                p1 = (
                    int(bounds.cx + bounds.rx * np.cos(a1)),
                    int(bounds.cy + bounds.ry * np.sin(a1)),
                )
                p2 = (
                    int(bounds.cx + bounds.rx * np.cos(a2)),
                    int(bounds.cy + bounds.ry * np.sin(a2)),
                )
                cv2.line(frame, p1, p2, (0, 255, 100), 1)


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
) -> tuple[np.ndarray | None, np.ndarray | None]:
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
