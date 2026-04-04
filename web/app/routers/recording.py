"""Recording REST endpoints."""

from __future__ import annotations

import csv
import io
import logging
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from web.app.state import recording

logger = logging.getLogger("eye-tracker")

router = APIRouter(prefix="/api", tags=["recording"])


@router.post("/recording/start")
async def recording_start() -> JSONResponse:
    """Start recording tracking data."""
    if recording.active:
        return JSONResponse({"error": "Already recording"}, status_code=400)
    recording.active = True
    recording.start_time = time.time()
    recording.rows = []
    logger.info("Recording started")
    return JSONResponse({"status": "recording", "startTime": recording.start_time})


@router.post("/recording/stop")
async def recording_stop() -> JSONResponse:
    """Stop recording tracking data."""
    if not recording.active:
        return JSONResponse({"error": "Not recording"}, status_code=400)
    recording.active = False
    logger.info("Recording stopped -- %d rows captured", len(recording.rows))
    return JSONResponse(
        {
            "status": "stopped",
            "rows": len(recording.rows),
            "durationSeconds": round(time.time() - recording.start_time, 2),
        }
    )


@router.get("/recording/download")
async def recording_download() -> StreamingResponse:
    """Download recorded tracking data as CSV."""
    if not recording.rows:
        return JSONResponse({"error": "No recorded data"}, status_code=404)

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "tracker_id",
            "timestamp",
            "fps",
            "confidence",
            "pupil_cx",
            "pupil_cy",
            "pupil_ax",
            "pupil_ay",
            "pupil_angle",
            "eye_center_x",
            "eye_center_y",
            "gaze_ox",
            "gaze_oy",
            "gaze_oz",
            "gaze_dx",
            "gaze_dy",
            "gaze_dz",
        ]
    )

    for row in recording.rows:
        pupil = row.get("pupil") or {}
        gaze = row.get("gaze") or {}
        p_center = pupil.get("center", [None, None])
        p_axes = pupil.get("axes", [None, None])
        g_origin = gaze.get("origin", [None, None, None])
        g_dir = gaze.get("direction", [None, None, None])
        ec = row.get("eyeCenter", [None, None])

        writer.writerow(
            [
                row.get("tracker_id"),
                row.get("timestamp"),
                row.get("fps"),
                row.get("confidence"),
                p_center[0],
                p_center[1],
                p_axes[0],
                p_axes[1],
                pupil.get("angle"),
                ec[0],
                ec[1],
                g_origin[0],
                g_origin[1],
                g_origin[2],
                g_dir[0],
                g_dir[1],
                g_dir[2],
            ]
        )

    content = buf.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=eye_tracking_recording.csv"},
    )
