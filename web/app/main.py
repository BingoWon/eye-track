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
        cam_indices = config.get("cameras", [])
        for idx in cam_indices:
            try:
                instance = registry.add(int(idx), app_settings)
                apply_range_calibration(instance.state, int(idx), config)
            except RuntimeError:
                logger.warning("Could not open saved camera %d", idx)
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
    title="Eye Tracker WebSocket Server",
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
