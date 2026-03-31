# 👁️ Eye Tracking Platform

Open-source 3D eye tracking using affordable IR cameras (~$40). Computes real-time 3D gaze vectors from a near-eye infrared camera using classical computer vision — no machine learning required.

**Cross-platform**: macOS · Windows · Linux

## What It Does

1. **2D Pupil Detection** — Cascaded thresholding + concave angle filtering to robustly detect the pupil ellipse from IR camera frames
2. **3D Eye Center Estimation** — Orthogonal ray intersection across multiple frames to locate the 3D eyeball center
3. **3D Gaze Ray** — Projects the 2D pupil onto a spherical eye model to compute a 3D gaze direction vector
4. **OpenGL Visualization** — Optional wireframe eyeball rendering showing the computed gaze in real-time
5. **Unity Integration** — Outputs `gaze_vector.txt` for real-time VR/AR gaze control via the included `GazeFollower.cs`

> Based on the algorithms explained in [The Hidden Math Behind 3D Eye Tracking](https://www.youtube.com/watch?v=Gh8LS9erugE) by [JEOresearch](https://github.com/JEOresearch/EyeTracker).

## Quick Start

### Prerequisites
- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### Install & Run

```bash
# Clone the repository
git clone https://github.com/BingoWon/eye-tracking-platform.git
cd eye-tracking-platform

# Using uv (recommended)
uv sync
uv run python src/eye_tracker_3d.py

# Or using pip
pip install -e .
python src/eye_tracker_3d.py
```

A GUI will appear letting you select a camera or browse for a video file. A test video (`repos/EyeTracker/eye_test.mp4`) is included for testing without hardware.

### Controls
| Key | Action |
|-----|--------|
| `Q` | Quit |
| `Space` | Pause / Resume |
| `D` | Toggle debug view (2D detector only) |

## Hardware

You need a near-eye infrared camera mounted on glasses. The recommended setup costs under $50 total:

| Item | Spec |
|------|------|
| **GC0308 Camera** | 80° no-distortion · 120FPS · Black & White · IR night vision · 640×480 |
| **USB Extension Cable** | USB 2.0 is sufficient |
| **USB-A to USB-C Adapter** | If your machine only has USB-C ports |
| **Cheap Sunglasses** | Wearable mount for the camera |
| **Electrical Tape** | To secure camera and wires to frame |

> The camera must be mounted very close to the eye (3-5cm), angled to capture a full single-eye close-up. See [DIY Infrared Eye Tracker](https://www.youtube.com/watch?v=8lZqCMRMtC8) for build instructions.

## Platform Support

The capture backend is selected automatically:

| Platform | Backend | Notes |
|----------|---------|-------|
| **macOS** | AVFoundation | GC0308 works plug-and-play via UVC |
| **Windows** | DirectShow | Same as the original upstream project |
| **Linux** | V4L2 | Standard USB camera support |

OpenGL visualization is optional — the core tracking works without it. On macOS where Apple has deprecated OpenGL, the visualization may show warnings but still functions via the compatibility profile.

## Project Structure

```
eye-tracking-platform/
├── src/                          # Cross-platform adapted source code
│   ├── pupil_detector.py         # 2D pupil detection (cascaded thresholding)
│   ├── eye_tracker_3d.py         # 3D gaze vector computation + GUI
│   └── gl_sphere.py              # OpenGL eyeball visualization
├── docs/                         
│   └── replication_plan.md       # Detailed hardware list & algorithm walkthrough
├── repos/
│   └── EyeTracker/               # Original upstream repo (JEOresearch)
├── papers/                       # Related academic papers
├── subtitles/                    # Channel video subtitles for reference
└── pyproject.toml                # Python project config (uv / pip)
```

## Acknowledgments

- **Jason Orlosky** ([@JEOresearch](https://www.youtube.com/@jeoresearch)) — Original algorithm and open-source code
- **Paper**: [Model-aware 3D Eye Gaze from Weak and Few-shot Supervisions](https://arxiv.org/abs/2311.12157) — Advanced gaze estimation approach for future integration

## License

MIT
