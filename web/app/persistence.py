"""Persist and restore camera configuration, calibrations, and settings."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from web.app.state import PupilBounds, TrackingSettings

logger = logging.getLogger("eyetrack")

CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / ".eyetrack-config.json"

VALID_MODES = ("classic", "enhanced", "screen")


def persist_current_state() -> None:
    """Save the current tracker/settings state to disk.

    Cameras are keyed by unique_id (hardware identifier) so they
    survive reboots even if the OpenCV index changes.
    """
    from web.app.state import registry, settings

    # Build per-camera config keyed by unique_id
    camera_configs: dict[str, dict] = {}
    for t in registry.trackers.values():
        cfg: dict = {"index": t.camera_index, "eye": t.eye}
        if t.rotation != 0:
            cfg["rotation"] = t.rotation
        if t.state.pupil_bounds:
            b = t.state.pupil_bounds
            cfg["rangeCal"] = {"cx": b.cx, "cy": b.cy, "rx": b.rx, "ry": b.ry}
        if t.gaze_calibration:
            cfg["gazeCal"] = t.gaze_calibration
        camera_configs[t.unique_id] = cfg

    _save_config(settings, camera_configs)


def _save_config(
    settings: TrackingSettings,
    camera_configs: dict[str, dict],
) -> None:
    """Write configuration to disk."""
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
            "rangeMargin": settings.range_margin,
            "mode": settings.mode,
        },
        "cameras": camera_configs,
    }
    try:
        CONFIG_PATH.write_text(json.dumps(data, indent=2))
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
        "rangeMargin": "range_margin",
        "mode": "mode",
    }.items():
        if key in s:
            if attr == "mode":
                val = str(s[key])
                if val in VALID_MODES:
                    setattr(settings, attr, val)
            else:
                setattr(settings, attr, type(getattr(settings, attr))(s[key]))


def apply_range_calibration(state: "TrackingState", cam_cfg: dict) -> None:  # noqa: F821
    """Apply saved range calibration from a camera config dict."""
    rc = cam_cfg.get("rangeCal")
    if rc:
        state.pupil_bounds = PupilBounds(
            float(rc["cx"]), float(rc["cy"]), float(rc["rx"]), float(rc["ry"])
        )
