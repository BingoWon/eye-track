"""Frame processing pipeline -- pupil detection and 3D gaze."""

from __future__ import annotations

import logging
import time
from typing import Optional

import cv2
import numpy as np

from src.eye_tracker_3d import compute_average_intersection, update_and_average_point
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
            # Heuristic: goodness values typically range 0–1e8 for well-fitted ellipses
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

        if model_center_average == (320, 240):
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
