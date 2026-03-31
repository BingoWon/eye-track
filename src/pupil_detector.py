"""
OrloskyPupilDetector – Cross-Platform
=======================================
Full-featured 2D pupil detector with cascaded thresholding, concave angle
filtering, and ellipse goodness scoring.

Adapted from JEOresearch/EyeTracker (original by Jason Orlosky).
All algorithmic logic is preserved. Supports macOS (AVFoundation),
Windows (DirectShow), and Linux (V4L2) via automatic backend selection.
"""

import cv2
import numpy as np
import random
import math
import os
import sys
import platform
try:
    import tkinter as tk
    from tkinter import filedialog
    TK_AVAILABLE = True
except ImportError:
    TK_AVAILABLE = False


# ---------------------------------------------------------------------------
# Image pre-processing
# ---------------------------------------------------------------------------

def crop_to_aspect_ratio(image, width=640, height=480):
    """Crop the image to maintain a specific aspect ratio before resizing."""
    current_height, current_width = image.shape[:2]
    desired_ratio = width / height
    current_ratio = current_width / current_height

    if current_ratio > desired_ratio:
        new_width = int(desired_ratio * current_height)
        offset = (current_width - new_width) // 2
        cropped_img = image[:, offset:offset + new_width]
    else:
        new_height = int(current_width / desired_ratio)
        offset = (current_height - new_height) // 2
        cropped_img = image[offset:offset + new_height, :]

    return cv2.resize(cropped_img, (width, height))


def apply_binary_threshold(image, darkest_pixel_value, added_threshold):
    """Apply inverse binary thresholding."""
    threshold = darkest_pixel_value + added_threshold
    _, thresholded_image = cv2.threshold(image, threshold, 255, cv2.THRESH_BINARY_INV)
    return thresholded_image


# ---------------------------------------------------------------------------
# Darkest region search
# ---------------------------------------------------------------------------

def get_darkest_area(image):
    """
    Find the darkest square patch in the image via sparse sampling.
    Returns the center point of the darkest block.
    """
    ignore_bounds = 20
    image_skip_size = 10
    search_area = 20
    internal_skip_size = 5

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    min_sum = float('inf')
    darkest_point = (gray.shape[1] // 2, gray.shape[0] // 2)  # safe default

    for y in range(ignore_bounds, gray.shape[0] - ignore_bounds, image_skip_size):
        for x in range(ignore_bounds, gray.shape[1] - ignore_bounds, image_skip_size):
            current_sum = np.int64(0)
            num_pixels = 0
            for dy in range(0, search_area, internal_skip_size):
                if y + dy >= gray.shape[0]:
                    break
                for dx in range(0, search_area, internal_skip_size):
                    if x + dx >= gray.shape[1]:
                        break
                    current_sum += gray[y + dy][x + dx]
                    num_pixels += 1

            if current_sum < min_sum and num_pixels > 0:
                min_sum = current_sum
                darkest_point = (x + search_area // 2, y + search_area // 2)

    return darkest_point


# ---------------------------------------------------------------------------
# Masking
# ---------------------------------------------------------------------------

def mask_outside_square(image, center, size):
    """Mask all pixels outside a square defined by center and size."""
    x, y = center
    half_size = size // 2

    mask = np.zeros_like(image)
    top_left_x = max(0, x - half_size)
    top_left_y = max(0, y - half_size)
    bottom_right_x = min(image.shape[1], x + half_size)
    bottom_right_y = min(image.shape[0], y + half_size)
    mask[top_left_y:bottom_right_y, top_left_x:bottom_right_x] = 255

    return cv2.bitwise_and(image, mask)


# ---------------------------------------------------------------------------
# Contour filtering
# ---------------------------------------------------------------------------

def optimize_contours_by_angle(contours, image):
    """
    Refine contour points by keeping only those whose local curvature
    points inward (concave toward centroid).
    """
    if len(contours) < 1:
        return contours

    all_contours = np.concatenate(contours[0], axis=0)
    spacing = max(1, int(len(all_contours) / 25))

    filtered_points = []
    centroid = np.mean(all_contours, axis=0)

    for i in range(len(all_contours)):
        current_point = all_contours[i]
        prev_point = all_contours[i - spacing] if i - spacing >= 0 else all_contours[-spacing]
        next_point = all_contours[i + spacing] if i + spacing < len(all_contours) else all_contours[spacing]

        vec1 = prev_point - current_point
        vec2 = next_point - current_point

        with np.errstate(invalid='ignore'):
            norm_product = np.linalg.norm(vec1) * np.linalg.norm(vec2)
            if norm_product < 1e-8:
                continue
            angle = np.arccos(np.clip(np.dot(vec1, vec2) / norm_product, -1.0, 1.0))

        vec_to_centroid = centroid - current_point
        cos_threshold = np.cos(np.radians(60))

        if np.dot(vec_to_centroid, (vec1 + vec2) / 2) >= cos_threshold:
            filtered_points.append(current_point)

    if len(filtered_points) < 5:
        return all_contours.reshape((-1, 1, 2))

    return np.array(filtered_points, dtype=np.int32).reshape((-1, 1, 2))


def filter_contours_by_area_and_return_largest(contours, pixel_thresh, ratio_thresh):
    """Return the single largest contour that meets area and aspect ratio criteria."""
    max_area = 0
    largest_contour = None

    for contour in contours:
        area = cv2.contourArea(contour)
        if area >= pixel_thresh:
            x, y, w, h = cv2.boundingRect(contour)
            if min(w, h) == 0:
                continue
            current_ratio = max(w / h, h / w)
            if current_ratio <= ratio_thresh:
                if area > max_area:
                    max_area = area
                    largest_contour = contour

    return [largest_contour] if largest_contour is not None else []


# ---------------------------------------------------------------------------
# Ellipse quality assessment
# ---------------------------------------------------------------------------

def check_contour_pixels(contour, image_shape, debug_mode_on):
    """
    Check how many contour pixels fall near a fitted ellipse.
    Returns [absolute_count, ratio, overlap_mask].
    """
    if len(contour) < 5:
        return [0, 0, np.zeros(image_shape, dtype=np.uint8)]

    contour_mask = np.zeros(image_shape, dtype=np.uint8)
    cv2.drawContours(contour_mask, [contour], -1, 255, 1)

    ellipse_mask_thick = np.zeros(image_shape, dtype=np.uint8)
    ellipse_mask_thin = np.zeros(image_shape, dtype=np.uint8)
    ellipse = cv2.fitEllipse(contour)

    cv2.ellipse(ellipse_mask_thick, ellipse, 255, 10)
    cv2.ellipse(ellipse_mask_thin, ellipse, 255, 4)

    overlap_thick = cv2.bitwise_and(contour_mask, ellipse_mask_thick)
    overlap_thin = cv2.bitwise_and(contour_mask, ellipse_mask_thin)

    absolute_pixel_total_thick = np.sum(overlap_thick > 0)
    total_border_pixels = np.sum(contour_mask > 0)
    ratio_under_ellipse = (np.sum(overlap_thin > 0) / total_border_pixels
                           if total_border_pixels > 0 else 0)

    return [absolute_pixel_total_thick, ratio_under_ellipse, overlap_thin]


def check_ellipse_goodness(binary_image, contour, debug_mode_on):
    """
    Evaluate how well the binary blob matches the fitted ellipse.
    Returns [fill_ratio, 0, skew_ratio].
    """
    ellipse_goodness = [0, 0, 0]
    if len(contour) < 5:
        return ellipse_goodness

    ellipse = cv2.fitEllipse(contour)
    mask = np.zeros_like(binary_image)
    cv2.ellipse(mask, ellipse, 255, -1)

    ellipse_area = np.sum(mask == 255)
    if ellipse_area == 0:
        return ellipse_goodness

    covered_pixels = np.sum((binary_image == 255) & (mask == 255))
    ellipse_goodness[0] = covered_pixels / ellipse_area

    minor, major = ellipse[1]
    if minor > 0 and major > 0:
        ellipse_goodness[2] = min(major / minor, minor / major)

    return ellipse_goodness


# ---------------------------------------------------------------------------
# Core frame processing (cascaded thresholding pipeline)
# ---------------------------------------------------------------------------

def process_frames(thresh_strict, thresh_medium, thresh_relaxed,
                   frame, gray_frame, darkest_point,
                   debug_mode_on, render_cv_window):
    """
    Process three threshold levels, pick the best ellipse fit,
    refine via angle-based contour optimization, and return the
    fitted ellipse as a RotatedRect.
    """
    final_rotated_rect = ((0, 0), (0, 0), 0)

    image_array = [thresh_relaxed, thresh_medium, thresh_strict]
    name_array = ["relaxed", "medium", "strict"]
    final_contours = []
    goodness = 0
    kernel = np.ones((5, 5), np.uint8)

    gray_copies = [gray_frame.copy() for _ in range(3)]
    ellipse_reduced_contours = np.zeros_like(gray_frame)

    for i in range(3):
        dilated = cv2.dilate(image_array[i], kernel, iterations=2)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        reduced = filter_contours_by_area_and_return_largest(contours, 1000, 3)

        if len(reduced) > 0 and len(reduced[0]) > 5:
            current_goodness = check_ellipse_goodness(dilated, reduced[0], debug_mode_on)
            ellipse = cv2.fitEllipse(reduced[0])

            if debug_mode_on:
                cv2.imshow(name_array[i] + " threshold", image_array[i])

            total_pixels = check_contour_pixels(reduced[0], dilated.shape, debug_mode_on)
            cv2.ellipse(gray_copies[i], ellipse, (255, 0, 0), 2)

            final_goodness = current_goodness[0] * total_pixels[0] * total_pixels[0] * total_pixels[1]

            if final_goodness > 0 and final_goodness > goodness:
                goodness = final_goodness
                ellipse_reduced_contours = total_pixels[2]
                final_contours = reduced

    if debug_mode_on and isinstance(ellipse_reduced_contours, np.ndarray):
        cv2.imshow("Reduced contours of best thresholded image", ellipse_reduced_contours)

    test_frame = frame.copy()
    final_contours = [optimize_contours_by_angle(final_contours, gray_frame)]

    if (final_contours
            and not isinstance(final_contours[0], list)
            and len(final_contours[0]) > 5):
        ellipse = cv2.fitEllipse(final_contours[0])
        final_rotated_rect = ellipse
        cv2.ellipse(test_frame, ellipse, (55, 255, 0), 2)
        center_x, center_y = map(int, ellipse[0])
        cv2.circle(test_frame, (center_x, center_y), 3, (255, 255, 0), -1)
        cv2.putText(test_frame, "SPACE = play/pause", (10, 410),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 90, 30), 2)
        cv2.putText(test_frame, "Q     = quit", (10, 430),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 90, 30), 2)
        cv2.putText(test_frame, "D     = show debug", (10, 450),
                    cv2.FONT_HERSHEY_SIMPLEX, .55, (255, 90, 30), 2)

    if render_cv_window:
        cv2.imshow('Pupil Detection', test_frame)

    if len(final_contours[0]) >= 5:
        contour = np.array(final_contours[0], dtype=np.int32).reshape((-1, 1, 2))
        ellipse = cv2.fitEllipse(contour)
        cv2.ellipse(gray_frame, ellipse, (255, 255, 255), 2)

    return final_rotated_rect


# ---------------------------------------------------------------------------
# Single-frame API
# ---------------------------------------------------------------------------

def process_frame(frame):
    """Find the pupil in a single frame and return the ellipse RotatedRect."""
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
# Video / camera processing
# ---------------------------------------------------------------------------

def _get_capture_backend():
    """Return the appropriate OpenCV capture backend for the current OS."""
    system = platform.system()
    if system == "Darwin":
        return cv2.CAP_AVFOUNDATION
    elif system == "Windows":
        return cv2.CAP_DSHOW
    else:
        return cv2.CAP_V4L2


def process_video(video_path, input_method):
    """
    Load a video file (input_method=1) or camera (input_method=2)
    and run pupil detection on each frame.
    """
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output_video.mp4")
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, 30.0, (640, 480))

    if input_method == 1:
        cap = cv2.VideoCapture(video_path)
    elif input_method == 2:
        backend = _get_capture_backend()
        cap = cv2.VideoCapture(0, backend)
        if platform.system() == "Windows":
            cap.set(cv2.CAP_PROP_EXPOSURE, -5)
    else:
        print("Invalid video source.")
        return

    if not cap.isOpened():
        print("Error: Could not open video.")
        return

    debug_mode_on = False

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = crop_to_aspect_ratio(frame)
        darkest_point = get_darkest_area(frame)

        if debug_mode_on:
            darkest_image = frame.copy()
            cv2.circle(darkest_image, darkest_point, 10, (0, 0, 255), -1)
            cv2.imshow('Darkest image patch', darkest_image)

        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        darkest_pixel_value = gray_frame[darkest_point[1], darkest_point[0]]

        thresh_strict = apply_binary_threshold(gray_frame, darkest_pixel_value, 5)
        thresh_strict = mask_outside_square(thresh_strict, darkest_point, 250)
        thresh_medium = apply_binary_threshold(gray_frame, darkest_pixel_value, 15)
        thresh_medium = mask_outside_square(thresh_medium, darkest_point, 250)
        thresh_relaxed = apply_binary_threshold(gray_frame, darkest_pixel_value, 25)
        thresh_relaxed = mask_outside_square(thresh_relaxed, darkest_point, 250)

        process_frames(thresh_strict, thresh_medium, thresh_relaxed,
                       frame, gray_frame, darkest_point, debug_mode_on, True)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('d'):
            debug_mode_on = not debug_mode_on
            if not debug_mode_on:
                cv2.destroyAllWindows()
        elif key == ord('q'):
            break
        elif key == ord(' '):
            while True:
                key = cv2.waitKey(1) & 0xFF
                if key in (ord(' '), ord('q')):
                    break

    cap.release()
    out.release()
    cv2.destroyAllWindows()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def select_video():
    """
    Prompt user to select a video file. Falls back to the bundled test video.
    """
    # Try to find the test video in the repos directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    test_video = os.path.join(project_root, "repos", "EyeTracker", "eye_test.mp4")

    if os.path.exists(test_video):
        print(f"Found test video: {test_video}")
        process_video(test_video, 1)
    else:
        print("No test video found. Please select a video file.")
        root = tk.Tk()
        root.withdraw()
        video_path = filedialog.askopenfilename(
            title="Select Video File",
            filetypes=[("Video Files", "*.mp4;*.avi")]
        )
        if video_path:
            process_video(video_path, 1)
        else:
            print("No file selected. Exiting.")


if __name__ == "__main__":
    select_video()
