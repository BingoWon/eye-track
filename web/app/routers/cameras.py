"""Camera-related REST endpoints."""

from __future__ import annotations

import asyncio
import io

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from web.app.camera import capture_preview, detect_cameras_safe
from web.app.state import camera_mgr, tracking_state

router = APIRouter(prefix="/api", tags=["cameras"])


@router.get("/cameras")
async def list_cameras() -> JSONResponse:
    """List available cameras without opening them (no iPhone beep)."""
    loop = asyncio.get_event_loop()
    cameras = await loop.run_in_executor(None, detect_cameras_safe)
    return JSONResponse(
        {
            "cameras": cameras,
            "active": camera_mgr.camera_index if camera_mgr.is_running else None,
        }
    )


@router.get("/cameras/{index}/preview")
async def camera_preview(index: int) -> StreamingResponse:
    """Capture a single frame from the specified camera and return as JPEG."""
    loop = asyncio.get_event_loop()
    jpeg_bytes = await loop.run_in_executor(None, capture_preview, index)

    if jpeg_bytes is None:
        return JSONResponse({"error": f"Cannot capture from camera {index}"}, status_code=400)

    return StreamingResponse(
        io.BytesIO(jpeg_bytes),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/camera/{index}")
async def switch_camera(index: int) -> JSONResponse:
    """Switch to a different camera by index."""
    ok = camera_mgr.start(index)
    if not ok:
        return JSONResponse({"error": f"Could not open camera {index}"}, status_code=400)
    # Reset tracking state for the new camera
    tracking_state.reset()
    return JSONResponse({"cameraIndex": index, "running": True})
