"""WebSocket endpoint."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from web.app.state import registry, settings, ws_clients

logger = logging.getLogger("eye-tracker")

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    ws_clients.add(ws)
    logger.info("WebSocket client connected (%d total)", len(ws_clients))

    # Send initial status with list of active trackers
    try:
        trackers_info = [
            {
                "id": t.id,
                "cameraIndex": t.camera_index,
                "running": t.camera.is_running,
                "cameraFps": round(t.camera.camera_fps, 1),
            }
            for t in registry.trackers.values()
        ]
        await ws.send_text(
            json.dumps(
                {
                    "type": "status",
                    "trackers": trackers_info,
                    "streamFps": settings.stream_fps,
                }
            )
        )
    except Exception:
        ws_clients.discard(ws)
        return

    try:
        # Keep connection alive; listen for client messages (unused for now)
        while True:
            data = await ws.receive_text()
            # Clients can send ping / settings; currently a no-op placeholder.
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("WebSocket error", exc_info=True)
    finally:
        ws_clients.discard(ws)
        logger.info("WebSocket client disconnected (%d remaining)", len(ws_clients))
