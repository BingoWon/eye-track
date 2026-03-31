# Replication Plan: DIY 3D Eye Tracking System

This document provides a comprehensive plan for replicating the 3D eye tracking algorithms and hardware assembly described by JEOresearch in "The Hidden Math Behind 3D Eye Tracking". 

## 1. Hardware List
The goal is to build an accessible, highly accurate DIY tracker without expensive professional equipment.
*(Prices have been intentionally excluded per requirements)*

**Camera Options:**
*   **GC0308 Eye Tracking Camera** (Recommended for near-eye tracking due to built-in IR capabilities)
*   **Alternative Board Camera** (Poor standalone quality but modifiable for DIY use)
*   **Spinel Camera** (A slightly more advanced option found in the `EyeTracker` repository's notes)

**Supporting Mounts and Cables:**
*   **Custom LEDs** (Infrared - required for clear pupil illumination, specifically for Spinel builds)
*   **USB Extension Cables** (To extend camera reach from the device to the user's PC)
*   **Soft Wire Cabling** (For custom wiring)
*   **Electrical Tape** (To secure LEDs and wires)
*   **Cheap Sunglasses** (To act as a wearable mount to hold the cameras and LEDs near the eye)

---

## 2. Software / Algorithmic Requirements

At its core, the software pipeline needs to execute a sequence of computer vision (OpenCV) routines written in Python to map 2D IR frames into a 3D gaze vector.

### Phase 1: 2D Pupil Detection and Refinement
1.  **Darkest Region Search:** Iterate through sparse pixels to locate the darkest, most uniform patch, finding a general point on the pupil.
2.  **Cascaded Thresholding:** Apply 3 relaxed threshold values to the darkest patch to isolate the pupil contour effectively despite poor lighting or eyelid shadows.
3.  **Boundary Filtering (Concave Analysis):** Assess angles formed by the contour points. Correct ellipse points must face inward toward the pupil center. All outward-facing points (noise from eyelashes, reflections) are discarded.
4.  **2D Ellipse Fitting:** Fit an ellipse equation to the remaining cleaned, true pupil border points to obtain the 2D pupil center.

### Phase 2: 3D Eye Center Estimation
1.  **Find 2D Eye Center via Intersections:** Compute the lines orthogonal to the pupil ellipses in multiple frames. Collect sets of these lines and find a region where 3 or more intersect. Average the last ~30 intersections to derive a stable 2D Eye Center.
2.  **Establish 3D Eyeball Model:** Assume an average adult human eyeball diameter of 24mm.
3.  **Depth Placement:** Place the 24mm 3D sphere center aligned with the tracked 2D Eye Center, matching the Z-depth (Z-axis) to fit the variance observed across candidate pupil points.

### Phase 3: Calibrating the 3D Gaze Ray
1.  **3D Pupil Projection:** Take the computed 2D pupil center and project it out to the spherical model surface from the camera's perspective.
2.  **Vector Calculation:** The direction vector extending from the calculated 3D eyeball center, passing through the 3D pupil intersection on the sphere, generates the final 3D Gaze Ray.

---

## 3. Implementation Steps

1.  **Setup the Hardware:** Mount the GC0308 camera and IR LEDs onto the inner frame of the cheap sunglasses using electrical tape. Use the soft wire cabling to route power and USB data.
2.  **Environment Setup:** Ensure Python is installed, using OpenCV and Numpy. *(Note: Numpy 1.26.0 is recommended as versions >= 2.0.0 have known compatibility issues with the JEO `EyeTracker` repo).*
3.  **Execution:** Use the `JEOresearch/EyeTracker` Python code base (`OrloskyPupilDetector.py`). Ensure 640x480 resolution input to maintain robust scaling compatibility with the initial parameters.
4.  *(Optional/Advanced)*: If precision becomes an issue, incorporate the transformer-based network model outlined in the `Model-aware 3D Eye Gaze` paper for weak few-shot learning calibrations over the geometric pipeline.
