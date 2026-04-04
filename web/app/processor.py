"""Frame processing pipeline -- pupil detection."""

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
    """Processes a single frame through the pupil detection pipeline
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

        # Filter blinks and outliers
        ellipse, confidence = self._validate(ellipse, confidence)

        # Build tracking result and draw overlays
        tracking = self._build_tracking(frame, ellipse, confidence)

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
            # Goodness values typically range 1e3-1e5 for well-fitted ellipses
            confidence = min(1.0, best_goodness / 1e5) if best_goodness > 0 else 0.0
            return ellipse, confidence

        return None, 0.0

    def _validate(
        self, ellipse: Optional[tuple], confidence: float
    ) -> tuple[Optional[tuple], float]:
        """Reject blinks and out-of-range detections."""
        if ellipse is None:
            return None, 0.0
        if confidence < self.settings.min_confidence:
            return None, 0.0
        # Aspect ratio: real pupils <=2.0, blink slits >2.5
        axes = ellipse[1]
        minor, major = min(axes), max(axes)
        if minor > 0 and major / minor > self.settings.max_aspect_ratio:
            return None, 0.0
        # Pupil bounds: absolute image-coordinate bounding circle
        bounds = self.state.pupil_bounds
        if bounds is not None:
            px, py = float(ellipse[0][0]), float(ellipse[0][1])
            if not bounds.contains(px, py):
                return None, 0.0
        return ellipse, confidence

    def _build_tracking(
        self,
        frame: np.ndarray,
        ellipse: Optional[tuple],
        confidence: float,
    ) -> dict:
        """Draw overlays on *frame* (in-place) and return the tracking dict."""
        tracking: dict = {
            "pupil": None,
            "fps": 0.0,
            "confidence": round(confidence, 3),
            "timestamp": time.time(),
        }

        # Pupil bounds ellipse (dashed green) -- shows allowed pupil area
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

        return tracking
