"""Camera and tracker management REST endpoints."""

from __future__ import annotations

import asyncio
from io import BytesIO

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from web.app.camera import capture_preview, detect_cameras_safe
from web.app.state import registry, settings

router = APIRouter(prefix="/api", tags=["cameras"])


# ---------------------------------------------------------------------------
# Camera discovery (unchanged)
# ---------------------------------------------------------------------------


@router.get("/cameras")
async def list_cameras() -> JSONResponse:
    """List available cameras without opening them (no iPhone beep)."""
    loop = asyncio.get_event_loop()
    cameras = await loop.run_in_executor(None, detect_cameras_safe)
    return JSONResponse({"cameras": cameras})


@router.get("/cameras/{index}/preview")
async def camera_preview(index: int) -> StreamingResponse:
    """Capture a single frame from the specified camera and return as JPEG."""
    loop = asyncio.get_event_loop()
    jpeg_bytes = await loop.run_in_executor(None, capture_preview, index)

    if jpeg_bytes is None:
        return JSONResponse({"error": f"Cannot capture from camera {index}"}, status_code=400)

    return StreamingResponse(
        BytesIO(jpeg_bytes),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Tracker management
# ---------------------------------------------------------------------------


@router.post("/trackers")
async def add_tracker(body: dict) -> JSONResponse:
    """Add a new tracker for the given camera index."""
    camera_index = body.get("cameraIndex")
    if camera_index is None:
        return JSONResponse({"error": "cameraIndex is required"}, status_code=400)
    try:
        tracker = registry.add(int(camera_index), settings)
    except RuntimeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return JSONResponse({"id": tracker.id, "cameraIndex": tracker.camera_index})


@router.delete("/trackers/{tracker_id}")
async def remove_tracker(tracker_id: str) -> JSONResponse:
    """Remove a tracker."""
    ok = registry.remove(tracker_id)
    if not ok:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    return JSONResponse({"removed": tracker_id})


@router.get("/trackers")
async def list_trackers() -> JSONResponse:
    """List active trackers."""
    return JSONResponse(
        {
            "trackers": [
                {"id": t.id, "cameraIndex": t.camera_index, "running": t.camera.is_running}
                for t in registry.trackers.values()
            ]
        }
    )
