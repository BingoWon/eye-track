"""WebSocket broadcast loop -- grabs frames, processes, and sends to clients."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time

import cv2

from web.app import state
from web.app.state import (
    registry,
    settings,
    ws_clients,
)

logger = logging.getLogger("eyetrack")


async def broadcast_loop() -> None:
    """Grab the latest camera frame from every active camera, process it,
    and broadcast to all connected WebSocket clients at the configured
    stream FPS."""
    logger.info("Broadcast loop started")
    while True:
        try:
            target_interval = 1.0 / max(1, settings.stream_fps)
            t0 = time.monotonic()

            if state.paused:
                await asyncio.sleep(0.1)
                continue

            if not registry.trackers or not ws_clients:
                await asyncio.sleep(target_interval)
                continue

            camera_payloads: list[dict] = []

            for cam in registry.trackers.values():
                frame = cam.camera.get_frame()
                if frame is None:
                    continue

                t_capture = time.monotonic()

                # Apply 180° rotation if camera is mounted upside-down
                if cam.rotation == 180:
                    frame = cv2.rotate(frame, cv2.ROTATE_180)

                annotated, tracking = cam.processor.process(frame)

                encode_params = [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality]
                ok, buf = cv2.imencode(".jpg", annotated, encode_params)
                if not ok:
                    logger.warning("Failed to encode frame for tracker %s", cam.id)
                    continue

                b64_image = base64.b64encode(buf.tobytes()).decode("ascii")

                payload = {
                    "id": cam.id,
                    "cameraIndex": cam.camera_index,
                    "image": b64_image,
                    "tracking": tracking,
                    "tCapture": t_capture,
                }
                camera_payloads.append(payload)

            if camera_payloads:
                t_send = time.monotonic()
                # Attach timing: processing = tSend - tCapture per tracker
                for p in camera_payloads:
                    p["tProcessing"] = round((t_send - p.pop("tCapture")) * 1000, 2)
                message = json.dumps(
                    {
                        "type": "frame",
                        "trackers": camera_payloads,
                        "tSend": t_send,
                    }
                )

                state.latest_tracking = {
                    "trackers": [
                        {"id": p["id"], "tracking": p["tracking"]} for p in camera_payloads
                    ]
                }

                # Send to all clients; drop slow ones
                dead: list = []
                for ws in list(ws_clients):
                    try:
                        await ws.send_text(message)
                    except Exception:
                        dead.append(ws)
                for ws in dead:
                    ws_clients.discard(ws)

            elapsed = time.monotonic() - t0
            sleep_time = max(0.0, target_interval - elapsed)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            logger.info("Broadcast loop cancelled")
            return
        except Exception:
            logger.exception("Error in broadcast loop")
            await asyncio.sleep(0.1)
