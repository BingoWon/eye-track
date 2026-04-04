"""Persist and restore camera configuration, calibrations, and settings."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from web.app.state import PupilBounds, TrackingSettings

logger = logging.getLogger("eye-tracker")

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / ".eye-tracking-config.json"


def save_config(
    settings: TrackingSettings,
    camera_indices: list[int],
    gaze_calibrations: dict[int, dict],
    range_calibrations: dict[int, dict],
) -> None:
    """Save all configuration to disk."""
    data = {
        "settings": {
            "thresholdStrict": settings.threshold_strict,
            "thresholdMedium": settings.threshold_medium,
            "thresholdRelaxed": settings.threshold_relaxed,
            "maskSize": settings.mask_size,
            "streamFps": settings.stream_fps,
            "jpegQuality": settings.jpeg_quality,
            "minConfidence": settings.min_confidence,
            "maxAspectRatio": settings.max_aspect_ratio,
        },
        "cameras": camera_indices,
        "gazeCalibrations": gaze_calibrations,
        "rangeCalibrations": range_calibrations,
    }
    try:
        CONFIG_PATH.write_text(json.dumps(data, indent=2))
        logger.info("Config saved to %s", CONFIG_PATH)
    except Exception:
        logger.exception("Failed to save config")


def load_config() -> dict | None:
    """Load configuration from disk. Returns None if not found."""
    if not CONFIG_PATH.exists():
        return None
    try:
        data = json.loads(CONFIG_PATH.read_text())
        logger.info("Config loaded from %s", CONFIG_PATH)
        return data
    except Exception:
        logger.exception("Failed to load config")
        return None


def apply_settings(settings: TrackingSettings, data: dict) -> None:
    """Apply saved settings to the TrackingSettings instance."""
    s = data.get("settings", {})
    for key, attr in {
        "thresholdStrict": "threshold_strict",
        "thresholdMedium": "threshold_medium",
        "thresholdRelaxed": "threshold_relaxed",
        "maskSize": "mask_size",
        "streamFps": "stream_fps",
        "jpegQuality": "jpeg_quality",
        "minConfidence": "min_confidence",
        "maxAspectRatio": "max_aspect_ratio",
    }.items():
        if key in s:
            setattr(settings, attr, type(getattr(settings, attr))(s[key]))


def apply_range_calibration(state: "TrackingState", cam_idx: int, data: dict) -> None:  # noqa: F821
    """Apply saved range calibration to a camera state."""
    rc = data.get("rangeCalibrations", {}).get(str(cam_idx))
    if rc:
        state.pupil_bounds = PupilBounds(
            float(rc["cx"]), float(rc["cy"]), float(rc["rx"]), float(rc["ry"])
        )
        logger.info("Restored range calibration for camera %d", cam_idx)
