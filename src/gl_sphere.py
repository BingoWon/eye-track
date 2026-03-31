"""
gl_sphere – macOS Adapted OpenGL 3D Eyeball Visualization
==========================================================
Renders a wireframe sphere with a rotating green pupil ring
that tracks the computed gaze direction.

Adapted from JEOresearch/EyeTracker/3DTracker/gl_sphere.py.
Uses PyQt5 + PyOpenGL. On macOS, Apple has deprecated OpenGL but
PyOpenGL still functions via the compatibility profile.
"""

import sys
import numpy as np

try:
    from PyQt5.QtWidgets import QApplication, QMainWindow, QOpenGLWidget
    from PyQt5.QtCore import Qt, QTimer
    from OpenGL.GL import *
    from OpenGL.GLU import *
    OPENGL_AVAILABLE = True
except ImportError:
    OPENGL_AVAILABLE = False

# Singleton references
app = None
window = None
sphere_widget = None
CV_pupil_x = 0
CV_pupil_y = 0


if OPENGL_AVAILABLE:
    class SphereWidget(QOpenGLWidget):
        def __init__(self):
            super().__init__()
            self.setFocusPolicy(Qt.StrongFocus)
            self.sphere_rot_x = 0
            self.sphere_rot_y = 0
            self.last_x, self.last_y = 0, 0
            self.rot_x, self.rot_y = 0, 0
            self.sphere_vertices, self.sphere_indices = self.generate_wireframe_sphere(30, 30)
            self.circle_vertices = self.generate_circle_on_sphere(
                r_sphere=1.0, r_circle=0.2, num_segments=100
            )
            self.camera_position = np.array([0.0, 0.0, -3.0])
            self.ray_origin = None
            self.ray_direction = None
            self.sphere_center_x = 320
            self.sphere_center_y = 240

        def draw_2d_circle(self, x, y, radius=10, segments=32):
            w = self.width()
            h = self.height()

            glMatrixMode(GL_PROJECTION)
            glPushMatrix()
            glLoadIdentity()
            glOrtho(0, w, 0, h, -1, 1)

            glMatrixMode(GL_MODELVIEW)
            glPushMatrix()
            glLoadIdentity()

            y_flipped = h - y

            glColor3f(1.0, 1.0, 0.0)
            glLineWidth(2.0)
            glBegin(GL_LINE_LOOP)
            for i in range(segments):
                angle = 2 * np.pi * i / segments
                cx = x + np.cos(angle) * radius
                cy = y_flipped + np.sin(angle) * radius
                glVertex2f(cx, cy)
            glEnd()

            glPopMatrix()
            glMatrixMode(GL_PROJECTION)
            glPopMatrix()
            glMatrixMode(GL_MODELVIEW)

        def generate_wireframe_sphere(self, lat_div, lon_div):
            vertices = []
            indices = []
            for i in range(lat_div + 1):
                lat = np.pi * (-0.5 + float(i) / lat_div)
                z = np.sin(lat)
                zr = np.cos(lat)
                for j in range(lon_div + 1):
                    lon = 2 * np.pi * float(j) / lon_div
                    x = np.cos(lon) * zr
                    y = np.sin(lon) * zr
                    vertices.append((x, y, z))
            for i in range(lat_div):
                for j in range(lon_div):
                    p1 = i * (lon_div + 1) + j
                    p2 = p1 + lon_div + 1
                    indices.append((p1, p2))
                    indices.append((p1, p1 + 1))
            return np.array(vertices, dtype=np.float32), np.array(indices, dtype=np.int32)

        def generate_circle_on_sphere(self, r_sphere=1.0, r_circle=0.8, num_segments=100):
            circle_vertices = []
            plane_z = np.sqrt(r_sphere**2 - r_circle**2)
            for i in range(num_segments):
                angle = 2.0 * np.pi * i / num_segments
                x = np.cos(angle) * r_circle
                y = np.sin(angle) * r_circle
                z = plane_z
                circle_vertices.append((x, y, z))
            return np.array(circle_vertices, dtype=np.float32)

        def initializeGL(self):
            glEnable(GL_DEPTH_TEST)
            glPolygonMode(GL_FRONT_AND_BACK, GL_LINE)

        def resizeGL(self, w, h):
            glViewport(0, 0, w, h)
            glMatrixMode(GL_PROJECTION)
            glLoadIdentity()
            gluPerspective(45, w / max(1, h), 0.1, 100)
            glMatrixMode(GL_MODELVIEW)

        def paintGL(self):
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
            glLoadIdentity()
            glTranslatef(0.0, 0.0, -3)

            viewport_width = self.width()
            viewport_height = self.height()

            gl_x = (self.sphere_center_x / viewport_width) * 2.0 - 1.0
            gl_y = 1.0 - (self.sphere_center_y / viewport_height) * 2.0
            glTranslatef(gl_x * 1.5, gl_y * 1.5, 0.0)

            # Draw ray
            if self.ray_origin is not None and self.ray_direction is not None:
                glBegin(GL_LINES)
                glColor3f(1.0, 1.0, 1.0)
                glVertex3fv(self.ray_origin)
                glColor3f(0.0, 0.0, 0.0)
                glVertex3fv(self.ray_origin - self.ray_direction * 5.5)
                glEnd()

            plane_z = 1 / 1.05
            inner_radius = abs(plane_z)

            # Draw ray-sphere intersection marker
            if self.ray_origin is not None and self.ray_direction is not None:
                origin = self.ray_origin
                direction = -self.ray_direction

                a = np.dot(direction, direction)
                b = 2 * np.dot(origin, direction)
                c = np.dot(origin, origin) - inner_radius**2
                discriminant = b**2 - 4 * a * c

                if discriminant >= 0:
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

                    if t is not None:
                        intersection = origin + t * direction
                        glPushMatrix()
                        glColor3f(1.0, 1.0, 1.0)
                        glTranslatef(intersection[0], intersection[1], intersection[2])
                        quad = gluNewQuadric()
                        gluSphere(quad, 0.02, 10, 10)
                        glPopMatrix()

            glPushMatrix()
            glRotatef(self.sphere_rot_x, 1, 0, 0)
            glRotatef(self.sphere_rot_y, 0, 1, 0)

            # Wireframe sphere
            glColor3f(0.3, 0.3, 0.8)
            glLineWidth(1.5)
            glBegin(GL_LINES)
            for i1, i2 in self.sphere_indices:
                glVertex3fv(self.sphere_vertices[i1])
                glVertex3fv(self.sphere_vertices[i2])
            glEnd()

            # Forward axis (red line)
            glColor3f(1.0, 0.0, 0.0)
            glLineWidth(2.0)
            glBegin(GL_LINES)
            glVertex3f(0.0, 0.0, 0.0)
            glVertex3f(0.0, 0.0, 1.2)
            glEnd()

            # Green pupil ring
            glColor3f(0.0, 1.0, 0.0)
            glLineWidth(3.0)
            glBegin(GL_LINE_LOOP)
            for vertex in self.circle_vertices:
                glVertex3fv(vertex)
            glEnd()

            self.draw_2d_circle(CV_pupil_x, CV_pupil_y)

            glPopMatrix()


def start_gl_window():
    """Initialize and show the OpenGL sphere window."""
    global app, window, sphere_widget

    if not OPENGL_AVAILABLE:
        print("OpenGL dependencies not available. Skipping 3D visualization.")
        return None

    app = QApplication.instance() or QApplication(sys.argv)
    window = QMainWindow()
    sphere_widget = SphereWidget()
    window.setCentralWidget(sphere_widget)
    window.setWindowTitle("Wireframe Sphere Eye Tracker Display")
    window.resize(640, 480)
    window.show()

    timer = QTimer()
    timer.timeout.connect(lambda: None)
    timer.start(16)  # ~60 FPS event loop tick

    return app


def update_sphere_rotation(x, y, center_x, center_y, screen_width=640, screen_height=480):
    """
    Update the sphere rotation to match the detected pupil position.
    Returns an OpenCV-compatible image of the rendered sphere.
    """
    if sphere_widget is None:
        return None

    global CV_pupil_x, CV_pupil_y
    CV_pupil_x = x
    CV_pupil_y = y

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
    c_val = np.dot(L, L) - inner_radius**2

    discriminant = b**2 - 4 * a * c_val
    if discriminant < 0:
        return None

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
        return None

    intersection_point = origin + t * direction
    sphere_center_offset = np.array([sphere_offset_x * 1.5, sphere_offset_y * 1.5, 0.0])
    intersection_local = intersection_point - sphere_center_offset
    target_direction = intersection_local / np.linalg.norm(intersection_local)

    circle_local_center = np.array([0.0, 0.0, inner_radius])
    circle_local_center /= np.linalg.norm(circle_local_center)

    rotation_axis = np.cross(circle_local_center, target_direction)
    rotation_axis_norm = np.linalg.norm(rotation_axis)
    if rotation_axis_norm < 1e-6:
        return None

    rotation_axis /= rotation_axis_norm
    dot = np.clip(np.dot(circle_local_center, target_direction), -1.0, 1.0)
    angle_rad = np.arccos(dot)

    cos_a = np.cos(angle_rad)
    sin_a = np.sin(angle_rad)
    t_ = 1 - cos_a
    x_, y_, z_ = rotation_axis

    rotation_matrix = np.array([
        [t_ * x_ * x_ + cos_a,     t_ * x_ * y_ - sin_a * z_, t_ * x_ * z_ + sin_a * y_],
        [t_ * x_ * y_ + sin_a * z_, t_ * y_ * y_ + cos_a,     t_ * y_ * z_ - sin_a * x_],
        [t_ * x_ * z_ - sin_a * y_, t_ * y_ * z_ + sin_a * x_, t_ * z_ * z_ + cos_a]
    ])

    sy = np.sqrt(rotation_matrix[0, 0]**2 + rotation_matrix[1, 0]**2)
    if sy < 1e-6:
        x_rot = np.arctan2(-rotation_matrix[1, 2], rotation_matrix[1, 1])
        y_rot = np.arctan2(-rotation_matrix[2, 0], sy)
    else:
        x_rot = np.arctan2(rotation_matrix[2, 1], rotation_matrix[2, 2])
        y_rot = np.arctan2(-rotation_matrix[2, 0], sy)

    sphere_widget.sphere_center_x = center_x
    sphere_widget.sphere_center_y = center_y
    sphere_widget.sphere_rot_x = np.degrees(x_rot)
    sphere_widget.sphere_rot_y = np.degrees(y_rot)

    sphere_widget.update()

    try:
        glFinish()
        w = sphere_widget.width()
        h = sphere_widget.height()
        glReadBuffer(GL_FRONT)
        pixels = glReadPixels(0, 0, w, h, GL_RGB, GL_UNSIGNED_BYTE)
        image = np.frombuffer(pixels, dtype=np.uint8).reshape((h, w, 3))
        image = np.flipud(image)
        return image
    except Exception:
        return None
