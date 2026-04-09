"""FastAPI application factory -- creates the app, wires routers, mounts static files."""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# ---------------------------------------------------------------------------
# Path setup so we can import from src/
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from web.app.broadcast import broadcast_loop  # noqa: E402
from web.app.camera import resolve_camera_index  # noqa: E402
from web.app.persistence import apply_range_calibration, apply_settings, load_config  # noqa: E402
from web.app.routers import cameras, settings, ws  # noqa: E402
from web.app.state import registry  # noqa: E402
from web.app.state import settings as app_settings  # noqa: E402

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("eye-tracker")


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: restore config from disk
    config = load_config()
    if config:
        apply_settings(app_settings, config)
        camera_configs: dict[str, dict] = config.get("cameras", {})

        # Backwards compat: old config stored cameras as list[int]
        if isinstance(camera_configs, list):
            camera_configs = {f"index:{idx}": {"index": idx} for idx in camera_configs}

        for unique_id, cam_cfg in camera_configs.items():
            # Resolve current index from hardware identifier
            resolved_index = resolve_camera_index(unique_id)
            if resolved_index is None:
                # Fallback to saved index
                resolved_index = cam_cfg.get("index")
                if resolved_index is None:
                    logger.warning("Camera %s not found and no saved index", unique_id)
                    continue
                logger.warning(
                    "Camera %s not matched by ID, trying saved index %d",
                    unique_id, resolved_index,
                )

            rotation = int(cam_cfg.get("rotation", 0))
            eye = str(cam_cfg.get("eye", "right"))
            try:
                instance = registry.add(
                    int(resolved_index), app_settings,
                    rotation=rotation, unique_id=unique_id, eye=eye,
                )
                apply_range_calibration(instance.state, cam_cfg)
                if cam_cfg.get("gazeCal"):
                    instance.gaze_calibration = cam_cfg["gazeCal"]
            except RuntimeError:
                logger.warning("Could not open camera %s (index %d)", unique_id, resolved_index)

        logger.info("Restored %d trackers from config", len(registry.trackers))
    else:
        logger.info("No saved config — waiting for user selection")

    broadcast_task = asyncio.create_task(broadcast_loop())

    yield

    # Shutdown
    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass
    registry.stop_all()
    logger.info("Server shut down cleanly")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="EyeTrack Server",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(ws.router)
app.include_router(cameras.router)
app.include_router(settings.router)

# ---------------------------------------------------------------------------
# Serve frontend static files (must be last so it doesn't shadow API routes)
# ---------------------------------------------------------------------------

_frontend_dist = PROJECT_ROOT / "web" / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
    logger.info("Serving frontend from %s", _frontend_dist)
else:
    logger.info("Frontend dist directory not found at %s -- skipping static mount", _frontend_dist)
