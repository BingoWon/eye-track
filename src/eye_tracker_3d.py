"""
Orlosky3DEyeTracker – macOS Adapted
=====================================
Real-time 3D eye tracking system. Detects the pupil via cascaded
thresholding, estimates the 3D eye center from orthogonal ray
intersections, and computes a 3D gaze direction vector.

Adapted from JEOresearch/EyeTracker/3DTracker/Orlosky3DEyeTracker.py.
All algorithmic logic is preserved; platform-specific code replaced
with cross-platform equivalents.
"""

import cv2
import random
import math
import numpy as np
import os
import platform
import sys
import time
try:
    import tkinter as tk
    from tkinter import ttk, filedialog
    TK_AVAILABLE = True
except ImportError:
    TK_AVAILABLE = False

# Import our adapted modules
try:
    from src import gl_sphere
    GL_SPHERE_AVAILABLE = gl_sphere.OPENGL_AVAILABLE
except ImportError:
    try:
        import gl_sphere
        GL_SPHERE_AVAILABLE = gl_sphere.OPENGL_AVAILABLE
    except ImportError:
        GL_SPHERE_AVAILABLE = False
        print("gl_sphere module not found. OpenGL rendering will be disabled.")

# Import pupil detection primitives from our adapted detector
try:
    from src.pupil_detector import (
        crop_to_aspect_ratio, apply_binary_threshold, get_darkest_area,
        mask_outside_square, optimize_contours_by_angle,
        filter_contours_by_area_and_return_largest, check_contour_pixels,
        check_ellipse_goodness, _get_capture_backend,
    )
except ImportError:
    from pupil_detector import (
        crop_to_aspect_ratio, apply_binary_threshold, get_darkest_area,
        mask_outside_square, optimize_contours_by_angle,
        filter_contours_by_area_and_return_largest, check_contour_pixels,
        check_ellipse_goodness, _get_capture_backend,
    )


# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
ray_lines = []
model_centers = []
max_rays = 100
prev_model_center_avg = (320, 240)
max_observed_distance = 0
stored_intersections = []


# ---------------------------------------------------------------------------
# Camera detection (cross-platform)
# ---------------------------------------------------------------------------

def detect_cameras(max_cams=10):
    """Detect available cameras using the appropriate backend."""
    available_cameras = []
    backend = _get_capture_backend()
    for i in range(max_cams):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            available_cameras.append(i)
            cap.release()
    return available_cameras


# ---------------------------------------------------------------------------
# Running average utilities
# ---------------------------------------------------------------------------

def update_and_average_point(point_list, new_point, N):
    """
    Add a new point to the list, keep only the last N points,
    return the average.
    """
    point_list.append(new_point)
    if len(point_list) > N:
        point_list.pop(0)
    if not point_list:
        return None
    avg_x = int(np.mean([p[0] for p in point_list]))
    avg_y = int(np.mean([p[1] for p in point_list]))
    return (avg_x, avg_y)


# ---------------------------------------------------------------------------
# Ray geometry utilities
# ---------------------------------------------------------------------------

def draw_orthogonal_ray(image, ellipse, length=100, color=(0, 255, 0), thickness=1):
    """Draw a ray orthogonal to the ellipse's minor axis through its center."""
    (cx, cy), (major_axis, minor_axis), angle = ellipse
    angle_rad = np.deg2rad(angle)
    normal_dx = (minor_axis / 2) * np.cos(angle_rad)
    normal_dy = (minor_axis / 2) * np.sin(angle_rad)

    pt1 = (int(cx - length * normal_dx / (minor_axis / 2)),
            int(cy - length * normal_dy / (minor_axis / 2)))
    pt2 = (int(cx + length * normal_dx / (minor_axis / 2)),
            int(cy + length * normal_dy / (minor_axis / 2)))

    cv2.line(image, pt1, pt2, color, thickness)
    return image


def find_line_intersection(ellipse1, ellipse2):
    """Compute the intersection of two lines orthogonal to given ellipses."""
    (cx1, cy1), (_, minor_axis1), angle1 = ellipse1
    (cx2, cy2), (_, minor_axis2), angle2 = ellipse2

    angle1_rad = np.deg2rad(angle1)
    angle2_rad = np.deg2rad(angle2)

    dx1 = (minor_axis1 / 2) * np.cos(angle1_rad)
    dy1 = (minor_axis1 / 2) * np.sin(angle1_rad)
    dx2 = (minor_axis2 / 2) * np.cos(angle2_rad)
    dy2 = (minor_axis2 / 2) * np.sin(angle2_rad)

    A = np.array([[dx1, -dx2], [dy1, -dy2]])
    B = np.array([cx2 - cx1, cy2 - cy1])

    if abs(np.linalg.det(A)) < 1e-10:
        return None

    t1, _ = np.linalg.solve(A, B)

    intersection_x = cx1 + t1 * dx1
    intersection_y = cy1 + t1 * dy1

    return (int(intersection_x), int(intersection_y))


def prune_intersections(intersections, maximum):
    """Remove oldest intersections to maintain the last `maximum` entries."""
    if len(intersections) <= maximum:
        return intersections
    return intersections[-maximum:]


def compute_average_intersection(frame, ray_lines_list, N, M, spacing):
    """
    Select N random rays, find pairwise intersections, store them,
    and return the running average intersection point (2D eye center estimate).
    """
    global stored_intersections

    if len(ray_lines_list) < 2 or N < 2:
        return (0, 0)

    height, width = frame.shape[:2]
    selected_lines = random.sample(ray_lines_list, min(N, len(ray_lines_list)))
    intersections = []

    for i in range(len(selected_lines) - 1):
        line1 = selected_lines[i]
        line2 = selected_lines[i + 1]

        angle1 = line1[2]
        angle2 = line2[2]

        if abs(angle1 - angle2) >= 2:
            intersection = find_line_intersection(line1, line2)
            if (intersection
                    and 0 <= intersection[0] < width
                    and 0 <= intersection[1] < height):
                intersections.append(intersection)
                stored_intersections.append(intersection)

    if len(stored_intersections) > M:
        stored_intersections = prune_intersections(stored_intersections, M)

    if not intersections:
        return None

    avg_x = np.mean([pt[0] for pt in stored_intersections])
    avg_y = np.mean([pt[1] for pt in stored_intersections])

    return (int(avg_x), int(avg_y))


# ---------------------------------------------------------------------------
# 3D gaze vector computation
# ---------------------------------------------------------------------------

def compute_gaze_vector(x, y, center_x, center_y,
                        screen_width=640, screen_height=480):
    """
    Compute 3D gaze direction from 2D pupil center and 2D eye center
    screen coordinates using a spherical eye model.

    Returns:
        (sphere_center, gaze_direction) — both np.ndarray[3], or (None, None)
    """
    viewport_width = screen_width
    viewport_height = screen_height

    fov_y_deg = 45.0
    aspect_ratio = viewport_width / viewport_height
    far_clip = 100.0

    camera_position = np.array([0.0, 0.0, 3.0])

    fov_y_rad = np.radians(fov_y_deg)
    half_height_far = np.tan(fov_y_rad / 2) * far_clip
    half_width_far = half_height_far * aspect_ratio

    ndc_x = (2.0 * x) / viewport_width - 1.0
    ndc_y = 1.0 - (2.0 * y) / viewport_height

    far_x = ndc_x * half_width_far
    far_y = ndc_y * half_height_far
    far_z = camera_position[2] - far_clip
    far_point = np.array([far_x, far_y, far_z])

    ray_origin = camera_position
    ray_direction = far_point - camera_position
    ray_direction /= np.linalg.norm(ray_direction)
    ray_direction = -ray_direction

    inner_radius = 1.0 / 1.05
    sphere_offset_x = (center_x / screen_width) * 2.0 - 1.0
    sphere_offset_y = 1.0 - (center_y / screen_height) * 2.0
    sphere_center = np.array([sphere_offset_x * 1.5, sphere_offset_y * 1.5, 0.0])

    origin = ray_origin
    direction = -ray_direction
    L = origin - sphere_center

    a = np.dot(direction, direction)
    b = 2 * np.dot(direction, L)
    c = np.dot(L, L) - inner_radius**2

    discriminant = b**2 - 4 * a * c
    if discriminant < 0:
        t = -np.dot(direction, L) / np.dot(direction, direction)
        intersection_point = origin + t * direction
        intersection_local = intersection_point - sphere_center
        target_direction = intersection_local / np.linalg.norm(intersection_local)
    else:
        sqrt_disc = np.sqrt(discriminant)
        t1 = (-b - sqrt_disc) / (2 * a)
        t2 = (-b + sqrt_disc) / (2 * a)

        t = None
        if t1 > 0 and t2 > 0:
            t = min(t1, t2)
        elif t1 > 0:
            t = t1
        elif t2 > 0:
            t = t2
        if t is None:
            return None, None

    # Recompute final intersection
    sqrt_disc = np.sqrt(max(discriminant, 0))
    t1 = (-b - sqrt_disc) / (2 * a)
    t2 = (-b + sqrt_disc) / (2 * a)

    t = None
    if t1 > 0 and t2 > 0:
        t = min(t1, t2)
    elif t1 > 0:
        t = t1
    elif t2 > 0:
        t = t2
    if t is None:
        return None, None

    intersection_point = origin + t * direction
    intersection_local = intersection_point - sphere_center
    target_direction = intersection_local / np.linalg.norm(intersection_local)

    circle_local_center = np.array([0.0, 0.0, inner_radius])
    circle_local_center /= np.linalg.norm(circle_local_center)

    rotation_axis = np.cross(circle_local_center, target_direction)
    rotation_axis_norm = np.linalg.norm(rotation_axis)
    if rotation_axis_norm < 1e-6:
        return sphere_center, circle_local_center

    rotation_axis /= rotation_axis_norm
    dot = np.clip(np.dot(circle_local_center, target_direction), -1.0, 1.0)
    angle_rad = np.arccos(dot)

    cos_a = np.cos(angle_rad)
    sin_a = np.sin(angle_rad)
    t_ = 1 - cos_a
    x_, y_, z_ = rotation_axis

    rotation_matrix = np.array([
        [t_ * x_ * x_ + cos_a,      t_ * x_ * y_ - sin_a * z_, t_ * x_ * z_ + sin_a * y_],
        [t_ * x_ * y_ + sin_a * z_, t_ * y_ * y_ + cos_a,      t_ * y_ * z_ - sin_a * x_],
        [t_ * x_ * z_ - sin_a * y_, t_ * y_ * z_ + sin_a * x_, t_ * z_ * z_ + cos_a]
    ])

    gaze_local = np.array([0.0, 0.0, inner_radius])
    gaze_rotated = rotation_matrix @ gaze_local
    gaze_rotated /= np.linalg.norm(gaze_rotated)

    # Write gaze vector to file for Unity integration
    file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gaze_vector.txt")
    try:
        with open(file_path, "w") as f:
            all_values = np.concatenate((sphere_center, gaze_rotated))
            csv_line = ",".join(f"{v:.6f}" for v in all_values)
            f.write(csv_line + "\n")
    except Exception as e:
        print(f"Write error: {e}")

    return sphere_center, gaze_rotated


# ---------------------------------------------------------------------------
# Core 3D frame processing
# ---------------------------------------------------------------------------

def process_frames(thresh_strict, thresh_medium, thresh_relaxed,
                   frame, gray_frame, darkest_point,
                   debug_mode_on, render_cv_window):
    """
    Process three threshold levels for the best pupil ellipse,
    compute the 3D eye center and gaze direction.
    """
    global ray_lines, max_rays, prev_model_center_avg, max_observed_distance

    kernel = np.ones((5, 5), np.uint8)
    final_rotated_rect = ((0, 0), (0, 0), 0)

    image_array = [thresh_relaxed, thresh_medium, thresh_strict]
    name_array = ["relaxed", "medium", "strict"]
    final_contours = []
    goodness = 0
    gray_copies = [gray_frame.copy() for _ in range(3)]
    final_goodness = 0
    center_x, center_y = None, None

    for i in range(3):
        dilated = cv2.dilate(image_array[i], kernel, iterations=2)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        reduced = filter_contours_by_area_and_return_largest(contours, 1000, 3)

        center_x_i, center_y_i = None, None

        if len(reduced) > 0 and len(reduced[0]) > 5:
            current_goodness = check_ellipse_goodness(dilated, reduced[0], debug_mode_on)
            ellipse = cv2.fitEllipse(reduced[0])
            center_x_i, center_y_i = map(int, ellipse[0])

            if debug_mode_on:
                cv2.imshow(name_array[i] + " threshold", gray_copies[i])

            total_pixels = check_contour_pixels(reduced[0], dilated.shape, debug_mode_on)
            cv2.ellipse(gray_copies[i], ellipse, (255, 0, 0), 2)

            final_goodness = current_goodness[0] * total_pixels[0] * total_pixels[0] * total_pixels[1]

        if final_goodness > 0 and final_goodness > goodness:
            goodness = final_goodness
            final_contours = reduced
            center_x, center_y = center_x_i, center_y_i

    final_contours = [optimize_contours_by_angle(final_contours, gray_frame)]
    final_rotated_rect = None

    if (final_contours
            and not isinstance(final_contours[0], list)
            and len(final_contours[0]) > 5):
        ellipse = cv2.fitEllipse(final_contours[0])
        final_rotated_rect = ellipse

        ray_lines.append(final_rotated_rect)
        if len(ray_lines) > max_rays:
            ray_lines = ray_lines[-max_rays:]

    # Compute 2D eye center from ray intersections
    model_center_average = (320, 240)
    model_center = compute_average_intersection(frame, ray_lines, 5, 1500, 5)
    if model_center is not None:
        model_center_average = update_and_average_point(model_centers, model_center, 200)

    if model_center_average[0] == 320:
        model_center_average = prev_model_center_avg
    if model_center_average[0] != 0:
        prev_model_center_avg = model_center_average

    if center_x is None or center_y is None:
        return final_rotated_rect

    max_observed_distance = 202

    # Draw visualizations
    cv2.circle(frame, model_center_average, int(max_observed_distance), (255, 50, 50), 2)
    cv2.circle(frame, model_center_average, 8, (255, 255, 0), -1)

    if final_rotated_rect is not None:
        cv2.line(frame, model_center_average, (center_x, center_y), (255, 150, 50), 2)
        cv2.ellipse(frame, final_rotated_rect, (20, 255, 255), 2)

        dx = center_x - model_center_average[0]
        dy = center_y - model_center_average[1]
        extended_x = int(model_center_average[0] + 2 * dx)
        extended_y = int(model_center_average[1] + 2 * dy)
        cv2.line(frame, (center_x, center_y), (extended_x, extended_y), (200, 255, 0), 3)

    # OpenGL sphere visualization
    if GL_SPHERE_AVAILABLE:
        gl_image = gl_sphere.update_sphere_rotation(
            center_x, center_y,
            model_center_average[0], model_center_average[1]
        )

    # Compute and display 3D gaze vector
    center_3d, direction_3d = compute_gaze_vector(
        center_x, center_y,
        model_center_average[0], model_center_average[1]
    )

    if center_3d is not None and direction_3d is not None:
        origin_text = f"Origin: ({center_3d[0]:.2f}, {center_3d[1]:.2f}, {center_3d[2]:.2f})"
        dir_text = f"Direction: ({direction_3d[0]:.2f}, {direction_3d[1]:.2f}, {direction_3d[2]:.2f})"

        text_origin = (12, frame.shape[0] - 38)
        text_dir = (12, frame.shape[0] - 13)
        text_origin2 = (10, frame.shape[0] - 40)
        text_dir2 = (10, frame.shape[0] - 15)

        cv2.putText(frame, origin_text, text_origin, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, dir_text, text_dir, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(frame, origin_text, text_origin2, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
        cv2.putText(frame, dir_text, text_dir2, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

    cv2.imshow("Frame with Ellipse and Rays", frame)

    if GL_SPHERE_AVAILABLE:
        try:
            if gl_image is not None:
                blended = cv2.addWeighted(frame, 0.6, gl_image, 0.4, 0)
                cv2.imshow("Eye Tracker + Sphere", blended)
        except Exception:
            pass

    return final_rotated_rect


# ---------------------------------------------------------------------------
# Single-frame API
# ---------------------------------------------------------------------------

def process_frame(frame):
    """Find the pupil + compute 3D gaze for a single frame."""
    frame = crop_to_aspect_ratio(frame)
    darkest_point = get_darkest_area(frame)
    gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    darkest_pixel_value = gray_frame[darkest_point[1], darkest_point[0]]

    thresh_strict = apply_binary_threshold(gray_frame, darkest_pixel_value, 5)
    thresh_strict = mask_outside_square(thresh_strict, darkest_point, 250)

    thresh_medium = apply_binary_threshold(gray_frame, darkest_pixel_value, 15)
    thresh_medium = mask_outside_square(thresh_medium, darkest_point, 250)

    thresh_relaxed = apply_binary_threshold(gray_frame, darkest_pixel_value, 25)
    thresh_relaxed = mask_outside_square(thresh_relaxed, darkest_point, 250)

    return process_frames(thresh_strict, thresh_medium, thresh_relaxed,
                          frame, gray_frame, darkest_point, False, False)


# ---------------------------------------------------------------------------
# Camera and video processing
# ---------------------------------------------------------------------------

def process_camera():
    """Process live camera feed for 3D eye tracking."""
    global selected_camera

    cam_index = int(selected_camera.get())
    backend = _get_capture_backend()

    cap = cv2.VideoCapture(cam_index, backend)

    # On macOS, exposure control may not be supported via this API
    if platform.system() != "Darwin":
        cap.set(cv2.CAP_PROP_EXPOSURE, -6)

    if not cap.isOpened():
        print(f"Error: Could not open camera at index {cam_index}.")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.flip(frame, 0)
        process_frame(frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):
            cv2.waitKey(0)

    cap.release()
    cv2.destroyAllWindows()


def process_video():
    """Browse for a video file and run 3D tracking on it."""
    video_path = filedialog.askopenfilename(
        filetypes=[("Video Files", "*.mp4;*.avi")]
    )
    if not video_path:
        return

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Error: Could not open video file.")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        process_frame(frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):
            cv2.waitKey(0)

    cap.release()
    cv2.destroyAllWindows()


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

def selection_gui():
    """Launch the Tkinter GUI for selecting camera or video input."""
    global selected_camera

    cameras = detect_cameras()

    root = tk.Tk()
    root.title("Select Input Source")
    tk.Label(root, text="Orlosky Eye Tracker 3D (macOS)", font=("Arial", 12, "bold")).pack(pady=10)

    tk.Label(root, text="Select Camera:").pack(pady=5)

    selected_camera = tk.StringVar()
    selected_camera.set(str(cameras[0]) if cameras else "No cameras found")

    camera_dropdown = ttk.Combobox(
        root, textvariable=selected_camera,
        values=[str(cam) for cam in cameras]
    )
    camera_dropdown.pack(pady=5)

    tk.Button(root, text="Start Camera",
              command=lambda: [root.destroy(), process_camera()]).pack(pady=5)
    tk.Button(root, text="Browse Video",
              command=lambda: [root.destroy(), process_video()]).pack(pady=5)

    # Also offer the test video if available
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    test_video = os.path.join(project_root, "repos", "EyeTracker", "eye_test.mp4")
    if os.path.exists(test_video):
        tk.Button(root, text="Run Test Video (eye_test.mp4)",
                  command=lambda: [root.destroy(), _run_test_video(test_video)]).pack(pady=5)

    if GL_SPHERE_AVAILABLE:
        app = gl_sphere.start_gl_window()

    root.mainloop()


def _run_test_video(video_path):
    """Run 3D tracking on the bundled test video."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("Error: Could not open test video.")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        process_frame(frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord(' '):
            cv2.waitKey(0)

    cap.release()
    cv2.destroyAllWindows()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    selection_gui()
