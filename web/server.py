"""Entry point for the EyeTrack web server.

Usage:
    uv run eyetrack
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from web.app.main import app  # noqa: E402, F401


def main():
    import uvicorn

    uvicorn.run(
        "web.server:app",
        host="0.0.0.0",
        port=8100,
        reload=True,
        log_level="info",
        ws="wsproto",
    )


if __name__ == "__main__":
    main()
