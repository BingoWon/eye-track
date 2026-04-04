"""Camera management REST endpoints."""

from __future__ import annotations

import asyncio
from io import BytesIO

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from web.app.camera import capture_preview, detect_cameras_safe
from web.app.persistence import save_config
from web.app.state import PupilBounds, registry, settings

router = APIRouter(prefix="/api", tags=["cameras"])


def _persist() -> None:
    """Save current camera config to disk."""
    cam_indices = [t.camera_index for t in registry.trackers.values()]
    range_cals: dict[int, dict] = {}
    for t in registry.trackers.values():
        if t.state.pupil_bounds:
            b = t.state.pupil_bounds
            range_cals[t.camera_index] = {"cx": b.cx, "cy": b.cy, "rx": b.rx, "ry": b.ry}
    save_config(settings, cam_indices, {}, range_cals)


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
# Active camera management
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
    _persist()
    return JSONResponse({"id": tracker.id, "cameraIndex": tracker.camera_index})


@router.delete("/trackers/{tracker_id}")
async def remove_tracker(tracker_id: str) -> JSONResponse:
    """Remove an active tracker."""
    ok = registry.remove(tracker_id)
    if not ok:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    _persist()
    return JSONResponse({"removed": tracker_id})


@router.get("/trackers")
async def list_trackers() -> JSONResponse:
    """List active trackers."""
    return JSONResponse(
        {
            "trackers": [
                {
                    "id": t.id,
                    "cameraIndex": t.camera_index,
                    "running": t.camera.is_running,
                    "rangeCalibrated": t.state.pupil_bounds is not None,
                }
                for t in registry.trackers.values()
            ]
        }
    )


@router.post("/trackers/{tracker_id}/range-calibrate")
async def range_calibrate(tracker_id: str, body: dict) -> JSONResponse:
    """Set the pupil bounding ellipse from a range calibration session.

    Body: { "cx": float, "cy": float, "rx": float, "ry": float }
    — absolute image-coordinate bounding ellipse for valid pupil positions.
    """
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)

    cx = body.get("cx")
    cy = body.get("cy")
    rx = body.get("rx")
    ry = body.get("ry")

    for name, val in [("cx", cx), ("cy", cy), ("rx", rx), ("ry", ry)]:
        if val is None or not isinstance(val, (int, float)):
            return JSONResponse({"error": f"{name} must be a number"}, status_code=400)

    if rx <= 0 or ry <= 0:
        return JSONResponse({"error": "rx and ry must be positive"}, status_code=400)

    tracker.state.pupil_bounds = PupilBounds(float(cx), float(cy), float(rx), float(ry))
    _persist()
    b = tracker.state.pupil_bounds
    return JSONResponse({"cameraId": tracker_id, "cx": b.cx, "cy": b.cy, "rx": b.rx, "ry": b.ry})


@router.delete("/trackers/{tracker_id}/range-calibrate")
async def clear_range_calibration(tracker_id: str) -> JSONResponse:
    """Clear range calibration for a tracker."""
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    tracker.state.pupil_bounds = None
    return JSONResponse({"cameraId": tracker_id, "cleared": True})
