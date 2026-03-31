# Replication Plan: DIY 3D Eye Tracking System

This document provides a comprehensive plan for replicating the 3D eye tracking algorithms and hardware assembly described by JEOresearch in "The Hidden Math Behind 3D Eye Tracking".

---

## 1. Hardware List

### Camera (Required)
| Item | Spec | Notes |
|------|------|-------|
| **GC0308 Eye Tracking Camera** | **80度无畸变 / 120FPS / 黑白画面 / 红外夜视** | This is the exact variant recommended by JEOresearch. 80° FOV provides an ideal field for near-eye mounting (~3-5cm from the eye). 120FPS ensures sharp pupil edges even during saccades. Black-and-white IR mode eliminates ambient light interference for reliable pupil thresholding. No-distortion lens preserves elliptical geometry critical for the 3D math. Native 640x480 resolution matches the algorithm's hardcoded parameters perfectly. |

### Cables (Required)
| Item | Notes |
|------|-------|
| **USB Extension Cable** | The GC0308 module ships with a short USB-A cable. An extension cable brings total reach to a comfortable length. |
| **USB-A to USB-C Adapter** | For connecting to Mac mini (which primarily uses Type-C ports). USB 2.0 is sufficient — the 640x480 120FPS black-and-white data stream fits well within USB 2.0's 480Mbps bandwidth. |

### Mounting (Required for near-eye tracking)
| Item | Notes |
|------|-------|
| **Cheap Sunglasses / Old Glasses Frame** | Acts as the wearable mount. The camera is taped to the inner frame, angled upward to capture a full-eye close-up. |
| **Soft Wire Cabling** | For routing and strain relief of the USB cable along the glasses frame. |
| **Electrical Tape** | To physically secure the camera module and wires to the glasses frame. |

### Optional
| Item | Notes |
|------|-------|
| **Additional IR LEDs** | For supplementary pupil illumination in low-light environments (e.g., for the Spinel camera variant which lacks built-in IR). Not needed for the GC0308 which has built-in IR LEDs. |

---

## 2. Repository Structure: `repos/EyeTracker`

The upstream `JEOresearch/EyeTracker` repository contains **5 independent sub-projects**. They share common pupil detection primitives but are each standalone applications that can be run independently:

### Root-Level Scripts (2D Pupil Detection Only)
| File | Purpose |
|------|---------|
| `OrloskyPupilDetector.py` | **Full-featured 2D pupil detector**. Cascaded thresholding (strict/medium/relaxed), concave angle filtering, ellipse goodness scoring. Outputs a 2D pupil ellipse per frame. Supports video file or DirectShow camera input. Includes debug visualization mode. |
| `OrloskyPupilDetectorLite.py` | **Lightweight 2D pupil detector**. Same core algorithm but uses only single (medium) threshold — faster but less robust. Requires good IR lighting. |
| `OrloskyPupilDetectorRaspberryPi.py` | **Raspberry Pi optimized 2D detector**. Even more aggressive sparse sampling (skip=20, internal=10) for low-power ARM performance. Displays FPS counter. Renders at 320x240 to reduce GPU load. |

### `3DTracker/` — Near-Eye 3D Gaze Tracking ⭐ (Primary Target)
| File | Purpose |
|------|---------|
| `Orlosky3DEyeTracker.py` | **The main 3D eye tracker** — this is what the YouTube video demonstrates. Extends the 2D pupil detector with: 3D eye center estimation via orthogonal ray intersections, 3D gaze vector computation via sphere-ray intersection math, real-time `gaze_vector.txt` output for Unity integration. Has a Tkinter GUI for camera/video selection. |
| `gl_sphere.py` | **OpenGL 3D visualization**. Renders a wireframe eyeball sphere with a green pupil ring that rotates to match the computed gaze direction. Uses PyQt5 + PyOpenGL. Optional — tracker works without it. |
| `GazeFollower.cs` | **Unity C# script**. Reads `gaze_vector.txt` each frame and applies the gaze origin/direction to a Unity GameObject. For VR/AR integration. |

### `FrontCameraTracker/` — Dual-Camera Gaze Projection
| File | Purpose |
|------|---------|
| `Orlosky3DEyeTrackerFrontCamera.py` | **Extended 3D tracker with external camera projection**. Uses TWO cameras simultaneously: one near-eye IR camera for pupil tracking, and one forward-facing webcam. Computes a calibration matrix (Rodrigues' rotation) so the gaze ray can project a red circle onto the external camera view showing where the user is looking. Adds click-to-set-center and `c` key calibration. |

### `HeadTracker/` — Head Pose Mouse Control
| File | Purpose |
|------|---------|
| `MonitorTracking.py` | **Head tracking mouse control** using MediaPipe Face Mesh. Estimates head yaw/pitch from facial landmarks and maps them to cursor position. |
| `CursorCircle.py` | **Cursor visualization overlay**. Draws a circle at the current mouse position for visual feedback. Companion to MonitorTracking.py. |

### `Webcam3DTracker/` — Webcam-Based 3D Eye+Head Tracking (Prototype)
| File | Purpose |
|------|---------|
| `MonitorTracking.py` | **Experimental webcam-only 3D eye tracker**. Uses MediaPipe face mesh landmarks to extract eye regions, then combines head pose with eye gaze for monitor-space tracking. Includes 3D orbit debug view and calibration. Still in prototype stage per the readme. |

---

## 3. Adaptation Strategy for macOS

The upstream code targets Windows exclusively (DirectShow APIs, MSMF capture backends, `C:\` paths). Our adapted version replaces all platform-specific code with cross-platform equivalents while preserving 100% of the algorithmic logic.

Key changes:
- Replace `cv2.CAP_DSHOW` / `cv2.CAP_MSMF` with `cv2.CAP_AVFOUNDATION` (macOS native)
- Remove hardcoded Windows paths (`C:/...`)
- Use `uv` with Python 3.14 for dependency management
- Pin compatible package versions (especially numpy)
- Replace `PyQt5` OpenGL with a macOS-compatible approach (PyQt5 + OpenGL still works on macOS but Apple has deprecated OpenGL — we handle this gracefully)

---

## 4. Implementation Phases

### Phase 1: Core 2D Pupil Detection ✅
Adapt `OrloskyPupilDetector.py` to run on macOS with video file input (using included `eye_test.mp4`).

### Phase 2: 3D Gaze Tracking ✅
Adapt `3DTracker/Orlosky3DEyeTracker.py` with full 3D gaze ray computation and `gaze_vector.txt` output.

### Phase 3: OpenGL Visualization (Optional)
Adapt `gl_sphere.py` for macOS OpenGL compatibility.

### Phase 4: Hardware Integration
Connect GC0308 camera and validate live tracking on Mac mini.
