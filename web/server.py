"""Entry point for the eye tracking web server.

Usage:
    uv run uvicorn web.server:app --host 0.0.0.0 --port 8100 --reload --ws wsproto
"""

from web.app.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "web.server:app",
        host="0.0.0.0",
        port=8100,
        reload=True,
        log_level="info",
        ws="wsproto",
    )
