"""Settings and status REST endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from web.app import state
from web.app.state import (
    camera_mgr,
    recording,
    settings,
    ws_clients,
)

logger = logging.getLogger("eye-tracker")

router = APIRouter(prefix="/api", tags=["settings"])

SETTINGS_BOUNDS: dict[str, tuple[int, int]] = {
    "threshold_strict": (1, 50),
    "threshold_medium": (1, 50),
    "threshold_relaxed": (1, 50),
    "mask_size": (50, 500),
    "stream_fps": (1, 120),
    "jpeg_quality": (10, 100),
}


@router.post("/settings")
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
            lo, hi = SETTINGS_BOUNDS.get(attr, (val, val))
            val = max(lo, min(hi, val))
            setattr(settings, attr, val)
            updated[key] = val

    if not updated:
        return JSONResponse({"error": "No valid settings provided"}, status_code=400)

    logger.info("Settings updated: %s", updated)
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
    return JSONResponse(
        {
            "cameraIndex": camera_mgr.camera_index,
            "cameraRunning": camera_mgr.is_running,
            "cameraFps": round(camera_mgr.camera_fps, 1),
            "streamFps": settings.stream_fps,
            "connectedClients": len(ws_clients),
            "recording": recording.active,
            "recordingRows": len(recording.rows),
            "latestTracking": state.latest_tracking or None,
        }
    )
