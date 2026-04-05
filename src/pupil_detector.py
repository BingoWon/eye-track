"""
OrloskyPupilDetector – Cross-Platform
=======================================
Full-featured 2D pupil detector with cascaded thresholding, concave angle
filtering, and ellipse goodness scoring.

Adapted from JEOresearch/EyeTracker (original by Jason Orlosky).
All algorithmic logic is preserved. Supports macOS (AVFoundation),
Windows (DirectShow), and Linux (V4L2) via automatic backend selection.
"""

import platform

import cv2
import numpy as np

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
        cropped_img = image[:, offset : offset + new_width]
    else:
        new_height = int(current_width / desired_ratio)
        offset = (current_height - new_height) // 2
        cropped_img = image[offset : offset + new_height, :]

    return cv2.resize(cropped_img, (width, height))


def apply_binary_threshold(image, darkest_pixel_value, added_threshold):
    """Apply inverse binary thresholding."""
    threshold = int(darkest_pixel_value) + added_threshold
    _, thresholded_image = cv2.threshold(image, threshold, 255, cv2.THRESH_BINARY_INV)
    return thresholded_image


# ---------------------------------------------------------------------------
# Darkest region search
# ---------------------------------------------------------------------------


def get_darkest_area(image):
    """
    Find the center of the darkest 20×20 patch in the image.
    Uses cv2.blur (box filter) for O(1)-per-pixel averaging.
    Returns the center point (x, y) of the darkest region.
    """
    border = 20
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.blur(gray, (20, 20))
    roi = blurred[border:-border, border:-border]
    min_idx = roi.argmin()
    min_y, min_x = np.unravel_index(min_idx, roi.shape)
    return (int(min_x) + border, int(min_y) + border)


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
        next_point = (
            all_contours[i + spacing] if i + spacing < len(all_contours) else all_contours[spacing]
        )

        vec1 = prev_point - current_point
        vec2 = next_point - current_point

        with np.errstate(invalid="ignore"):
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
    ratio_under_ellipse = (
        np.sum(overlap_thin > 0) / total_border_pixels if total_border_pixels > 0 else 0
    )

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


def _get_capture_backend():
    """Return the appropriate OpenCV capture backend for the current OS."""
    system = platform.system()
    if system == "Darwin":
        return cv2.CAP_AVFOUNDATION
    elif system == "Windows":
        return cv2.CAP_DSHOW
    else:
        return cv2.CAP_V4L2
