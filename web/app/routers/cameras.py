"""Camera management REST endpoints."""

from __future__ import annotations

import asyncio
from io import BytesIO

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from web.app import state
from web.app.camera import close_preview_cameras, detect_cameras_safe, get_preview_frame
from web.app.persistence import persist_current_state
from web.app.state import PupilBounds, registry, settings

router = APIRouter(prefix="/api", tags=["cameras"])


# ---------------------------------------------------------------------------
# Camera discovery
# ---------------------------------------------------------------------------


@router.get("/cameras")
async def list_cameras() -> JSONResponse:
    """List available cameras without opening them (no iPhone beep)."""
    loop = asyncio.get_event_loop()
    cameras = await loop.run_in_executor(None, detect_cameras_safe)
    return JSONResponse({"cameras": cameras})


@router.get("/cameras/{index}/preview")
async def camera_preview(index: int, rotation: int = 0) -> StreamingResponse:
    """Return the latest frame from a camera for live preview."""
    loop = asyncio.get_event_loop()
    jpeg_bytes = await loop.run_in_executor(None, get_preview_frame, index, rotation)

    if jpeg_bytes is None:
        return JSONResponse({"error": f"Cannot capture from camera {index}"}, status_code=400)

    return StreamingResponse(
        BytesIO(jpeg_bytes),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/cameras/enter-selection")
async def enter_camera_selection() -> JSONResponse:
    """Prepare for camera selection: stop all trackers and broadcast.

    This ensures preview has exclusive access to cameras — no signal
    contention between tracker capture threads and preview.
    """
    state.paused = True
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, registry.stop_all)
    # Brief delay to let OS fully release camera handles
    await asyncio.sleep(0.3)
    return JSONResponse({"stopped": True})


@router.delete("/cameras/preview")
async def close_previews() -> JSONResponse:
    """Release preview camera (called before creating trackers)."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, close_preview_cameras)
    return JSONResponse({"closed": True})


# ---------------------------------------------------------------------------
# Active camera management
# ---------------------------------------------------------------------------


@router.post("/trackers")
async def add_tracker(body: dict) -> JSONResponse:
    """Add a new tracker for the given camera index."""
    camera_index = body.get("cameraIndex")
    if camera_index is None:
        return JSONResponse({"error": "cameraIndex is required"}, status_code=400)
    if len(registry.trackers) >= 2 and not registry.find_by_index(int(camera_index)):
        return JSONResponse({"error": "Maximum 2 cameras supported"}, status_code=400)
    rotation = 180 if body.get("rotation") == 180 else 0
    unique_id = body.get("uniqueId") or f"index:{camera_index}"
    eye = body.get("eye", "right")
    if eye not in ("left", "right"):
        eye = "right"
    try:
        tracker = registry.add(
            int(camera_index), settings,
            rotation=rotation, unique_id=unique_id, eye=eye,
        )
    except RuntimeError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    persist_current_state()
    return JSONResponse({
        "id": tracker.id,
        "cameraIndex": tracker.camera_index,
        "uniqueId": tracker.unique_id,
        "eye": tracker.eye,
        "rotation": tracker.rotation,
    })


@router.delete("/trackers/{tracker_id}")
async def remove_tracker(tracker_id: str) -> JSONResponse:
    """Remove an active tracker."""
    ok = registry.remove(tracker_id)
    if not ok:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    persist_current_state()
    return JSONResponse({"removed": tracker_id})


@router.get("/trackers")
async def list_trackers() -> JSONResponse:
    """List active trackers."""
    return JSONResponse({
        "trackers": [
            {
                "id": t.id,
                "cameraIndex": t.camera_index,
                "eye": t.eye,
                "running": t.camera.is_running,
                "rangeCalibrated": t.state.pupil_bounds is not None,
                "gazeCalibration": t.gaze_calibration,
                "rotation": t.rotation,
            }
            for t in registry.trackers.values()
        ]
    })


@router.patch("/trackers/{tracker_id}/rotation")
async def set_rotation(tracker_id: str, body: dict) -> JSONResponse:
    """Set camera rotation (0 or 180 degrees)."""
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    tracker.rotation = 180 if body.get("rotation") == 180 else 0
    tracker.state.reset()
    persist_current_state()
    return JSONResponse({"id": tracker_id, "rotation": tracker.rotation})


@router.post("/trackers/{tracker_id}/range-calibrate")
async def range_calibrate(tracker_id: str, body: dict) -> JSONResponse:
    """Set the pupil bounding ellipse from a range calibration session."""
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
    persist_current_state()
    b = tracker.state.pupil_bounds
    return JSONResponse({"id": tracker_id, "cx": b.cx, "cy": b.cy, "rx": b.rx, "ry": b.ry})


@router.delete("/trackers/{tracker_id}/range-calibrate")
async def clear_range_calibration(tracker_id: str) -> JSONResponse:
    """Clear range calibration for a tracker."""
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    tracker.state.pupil_bounds = None
    return JSONResponse({"id": tracker_id, "cleared": True})


@router.post("/trackers/{tracker_id}/gaze-calibrate")
async def set_gaze_calibration(tracker_id: str, body: dict) -> JSONResponse:
    """Store gaze calibration coefficients for a tracker."""
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    tracker.gaze_calibration = body
    persist_current_state()
    return JSONResponse({"id": tracker_id, "stored": True})


@router.delete("/trackers/{tracker_id}/gaze-calibrate")
async def clear_gaze_calibration(tracker_id: str) -> JSONResponse:
    """Clear gaze calibration for a tracker."""
    tracker = registry.trackers.get(tracker_id)
    if not tracker:
        return JSONResponse({"error": "Tracker not found"}, status_code=404)
    tracker.gaze_calibration = None
    persist_current_state()
    return JSONResponse({"id": tracker_id, "cleared": True})
