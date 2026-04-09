"""Settings and status REST endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from web.app import state
from web.app.persistence import VALID_MODES, persist_current_state
from web.app.state import registry, settings, ws_clients

logger = logging.getLogger("eye-tracker")

router = APIRouter(prefix="/api", tags=["settings"])

# (attr_name, min, max, type)
SETTINGS_SCHEMA: dict[str, tuple[str, float | None, float | None, type]] = {
    "thresholdStrict": ("threshold_strict", 1, 50, int),
    "thresholdMedium": ("threshold_medium", 1, 50, int),
    "thresholdRelaxed": ("threshold_relaxed", 1, 50, int),
    "maskSize": ("mask_size", 50, 500, int),
    "streamFps": ("stream_fps", 1, 120, int),
    "jpegQuality": ("jpeg_quality", 10, 100, int),
    "minConfidence": ("min_confidence", 0.0, 1.0, float),
    "maxAspectRatio": ("max_aspect_ratio", 1.5, 5.0, float),
    "rangeMargin": ("range_margin", 1.0, 1.5, float),
    "mode": ("mode", None, None, str),
}


@router.post("/settings")
async def update_settings(body: dict) -> JSONResponse:
    """Update tracking parameters at runtime."""
    updated = {}
    for key, (attr, lo, hi, typ) in SETTINGS_SCHEMA.items():
        if key in body:
            if key == "mode":
                val = str(body[key])
                if val not in VALID_MODES:
                    continue
                settings.mode = val
                updated[key] = val
                continue
            val = typ(body[key])
            val = max(lo, min(hi, val))
            if typ is int:
                val = int(val)
            setattr(settings, attr, val)
            updated[key] = val

    if not updated:
        return JSONResponse({"error": "No valid settings provided"}, status_code=400)

    logger.info("Settings updated: %s", updated)
    persist_current_state()
    return JSONResponse({"updated": updated})


@router.post("/pause")
async def toggle_pause(body: dict) -> JSONResponse:
    """Pause or resume the tracking stream."""
    paused = body.get("paused")
    if paused is None:
        state.paused = not state.paused
    else:
        state.paused = bool(paused)
    logger.info("Tracking %s", "paused" if state.paused else "resumed")
    return JSONResponse({"paused": state.paused})


@router.get("/status")
async def get_status() -> JSONResponse:
    """Return current tracking status."""
    return JSONResponse({
        "trackerCount": len(registry.trackers),
        "trackers": [
            {
                "id": t.id,
                "cameraIndex": t.camera_index,
                "running": t.camera.is_running,
                "cameraFps": round(t.camera.camera_fps, 1),
            }
            for t in registry.trackers.values()
        ],
        "streamFps": settings.stream_fps,
        "connectedClients": len(ws_clients),
        "latestTracking": state.latest_tracking or None,
    })
