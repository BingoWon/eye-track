"""Frame processing pipeline -- pupil detection and 3D gaze."""

from __future__ import annotations

import logging
import time
from typing import Optional

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

        # Filter out blinks and outlier detections
        ellipse, confidence = self._validate_detection(ellipse, confidence)

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
            # Confidence: normalize goodness to 0-1 range
            # Goodness values typically range 1e3–1e5 for well-fitted ellipses
            confidence = min(1.0, best_goodness / 1e5) if best_goodness > 0 else 0.0
            return ellipse, confidence

        return None, 0.0

    def _validate_detection(
        self, ellipse: Optional[tuple], confidence: float
    ) -> tuple[Optional[tuple], float]:
        """Reject low-confidence detections (blinks, occlusions, etc.)."""
        if ellipse is None:
            return None, 0.0
        if confidence < self.settings.min_confidence:
            return None, 0.0
        return ellipse, confidence

    # Minimum angle difference (degrees) between two ellipses for a
    # reliable intersection.  Larger = more stable but updates less often.
    MIN_ANGLE_DIFF = 5.0

    def _compute_eye_center(self, frame: np.ndarray, ellipse: Optional[tuple]) -> tuple[int, int]:
        """Estimate the 2D eye center using EWMA over ray intersections.

        Each valid ellipse defines a ray (along its minor-axis normal) that
        should pass through the eye center.  When two rays from different
        gaze angles intersect, the intersection is a noisy estimate of the
        eye center.  We fuse these estimates with an exponential weighted
        moving average so recent frames matter most.
        """
        st = self.state
        h, w = frame.shape[:2]
        default = (w // 2, h // 2)

        if ellipse is None:
            # No detection — return current estimate or default
            if st.eye_center:
                return (int(st.eye_center[0]), int(st.eye_center[1]))
            return default

        # Try to intersect with the previous valid ellipse
        prev = st.prev_ellipse
        st.prev_ellipse = ellipse

        if prev is None:
            if st.eye_center:
                return (int(st.eye_center[0]), int(st.eye_center[1]))
            return default

        # Check angle difference — need enough rotation for a good intersection
        angle_diff = abs(ellipse[2] - prev[2])
        if angle_diff < self.MIN_ANGLE_DIFF:
            if st.eye_center:
                return (int(st.eye_center[0]), int(st.eye_center[1]))
            return default

        # Compute intersection of the two minor-axis normal rays
        intersection = self._intersect_ellipse_normals(prev, ellipse)
        if intersection is None:
            if st.eye_center:
                return (int(st.eye_center[0]), int(st.eye_center[1]))
            return default

        ix, iy = intersection

        # Reject if outside frame bounds
        if not (0 <= ix < w and 0 <= iy < h):
            if st.eye_center:
                return (int(st.eye_center[0]), int(st.eye_center[1]))
            return default

        # EWMA update
        alpha = self.settings.eye_center_alpha
        if st.eye_center is None:
            st.eye_center = (float(ix), float(iy))
        else:
            st.eye_center = (
                alpha * ix + (1 - alpha) * st.eye_center[0],
                alpha * iy + (1 - alpha) * st.eye_center[1],
            )

        return (int(st.eye_center[0]), int(st.eye_center[1]))

    @staticmethod
    def _intersect_ellipse_normals(e1: tuple, e2: tuple) -> Optional[tuple[float, float]]:
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

            # No overlay text — metrics are displayed in the web UI

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
        # No intersection — use closest approach point on the ray
        t = -np.dot(direction, L) / np.dot(direction, direction)
    else:
        # Actual ray-sphere intersection
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
