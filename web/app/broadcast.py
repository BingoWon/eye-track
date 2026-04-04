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
    camera_mgr,
    processor,
    recording,
    settings,
    ws_clients,
)

logger = logging.getLogger("eye-tracker")


async def broadcast_loop() -> None:
    """Grab the latest camera frame, process it, and broadcast to all
    connected WebSocket clients at the configured stream FPS."""
    logger.info("Broadcast loop started")
    while True:
        try:
            target_interval = 1.0 / max(1, settings.stream_fps)
            t0 = time.monotonic()

            frame = camera_mgr.get_frame()
            if frame is not None and ws_clients:
                annotated, tracking = processor.process(frame)

                # Encode JPEG
                encode_params = [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality]
                ok, buf = cv2.imencode(".jpg", annotated, encode_params)
                if ok:
                    b64_image = base64.b64encode(buf.tobytes()).decode("ascii")

                    message = json.dumps(
                        {
                            "type": "frame",
                            "image": b64_image,
                            "tracking": tracking,
                        }
                    )

                    state.latest_tracking = tracking

                    # Record if active
                    if recording.active:
                        recording.rows.append(tracking)

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
