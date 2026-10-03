"""
Diablo II sprite renderer for Blender (3.x / 4.x)
=================================================

Renders your animated model the way Diablo II's own sprites were made: an orthographic
camera looking down at 30 degrees (the game's 2:1 view), every facing direction, every
frame, on a transparent background. PD2 Sprite Studio imports the folder this writes.

How to use
----------
1. Put your model's feet on the ground at the world origin (0, 0, 0).
2. Open Blender's Scripting tab, open this file, adjust SETTINGS below, press Run Script once.
   It creates "D2_Camera" and an empty "D2_Turntable".
3. Parent your model (and its armature) to D2_Turntable.
4. Look through D2_Camera (Numpad 0) and rotate D2_Turntable (Z only) so the model faces
   the BOTTOM-LEFT of the picture. That is direction 0 in Diablo II. Then set
   TURNTABLE_START_YAW below to that rotation (degrees) - or just leave the turntable there
   and set RENDER = True and run again; it reads the current rotation as the start.
5. Set RENDER = True and run the script again. Renders go to OUTPUT_DIR.
6. In PD2 Sprite Studio: More > Import 3D renders, and pick that folder.

Tips: Diablo II characters are only ~70-90 px tall. Keep ORTHO_SCALE so your model fills
roughly that many pixels, and avoid tiny details - they won't survive at that size.
"""

import bpy
import json
import math
import os

# --------------------------------------------------------------------------------------------
# SETTINGS
DIRECTIONS = 16            # 16 for player characters, 8 for monsters
OUTPUT_DIR = "//d2_renders"  # "//" = next to the .blend file
NAME = "sprite"            # file name prefix
RESOLUTION = 192           # square render size in pixels
ORTHO_SCALE = 3.0          # world units visible across the picture (smaller = bigger model)
CAMERA_DISTANCE = 30.0     # just needs to be outside the model
SHARP_EDGES = True         # near-zero anti-aliasing so edges stay crisp after palette matching
RENDER = False             # False: only create/refresh camera + turntable. True: render everything
# --------------------------------------------------------------------------------------------

# Diablo II direction index -> screen heading (degrees, 0 = right, clockwise). Direction 0 faces
# the bottom-left. Each index is a fixed turn of the model relative to direction 0.
HEADING_8 = [135, 225, 315, 45, 90, 180, 270, 0]
HEADING_16 = HEADING_8 + [112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5]

ELEVATION = 30.0  # degrees above the ground (Diablo II's 2:1 view)
AZIMUTH = 45.0


def ensure_camera(scene):
    cam = bpy.data.objects.get("D2_Camera")
    if cam is None:
        data = bpy.data.cameras.new("D2_Camera")
        cam = bpy.data.objects.new("D2_Camera", data)
        scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ORTHO_SCALE
    cam.data.clip_end = CAMERA_DISTANCE * 4
    tilt = math.radians(90.0 - ELEVATION)
    az = math.radians(AZIMUTH)
    cam.rotation_mode = 'XYZ'
    cam.rotation_euler = (tilt, 0.0, az)
    # A Blender camera looks along its local -Z. With rotation Rz(az)*Rx(tilt) that is:
    forward = (
        -math.sin(tilt) * math.sin(az),
        math.sin(tilt) * math.cos(az),
        -math.cos(tilt),
    )
    # Place the camera back along its view line so it looks straight at the world origin.
    cam.location = (
        -forward[0] * CAMERA_DISTANCE,
        -forward[1] * CAMERA_DISTANCE,
        -forward[2] * CAMERA_DISTANCE,
    )
    scene.camera = cam
    return cam


def ensure_turntable(scene):
    tt = bpy.data.objects.get("D2_Turntable")
    if tt is None:
        tt = bpy.data.objects.new("D2_Turntable", None)
        tt.empty_display_type = 'ARROWS'
        tt.empty_display_size = 1.0
        scene.collection.objects.link(tt)
    tt.location = (0.0, 0.0, 0.0)
    tt.rotation_mode = 'XYZ'
    return tt


def setup_render(scene):
    r = scene.render
    r.resolution_x = RESOLUTION
    r.resolution_y = RESOLUTION
    r.resolution_percentage = 100
    r.film_transparent = True
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
    if SHARP_EDGES:
        r.filter_size = 0.01
    try:
        scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass


def main():
    scene = bpy.context.scene
    cam = ensure_camera(scene)
    tt = ensure_turntable(scene)
    setup_render(scene)
    if not RENDER:
        print("D2 camera and turntable ready. Parent your model to D2_Turntable, face it bottom-left, then set RENDER = True.")
        return

    headings = HEADING_16 if DIRECTIONS == 16 else HEADING_8
    start_yaw = tt.rotation_euler[2]
    out_dir = bpy.path.abspath(OUTPUT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    f0, f1 = scene.frame_start, scene.frame_end
    n_frames = f1 - f0 + 1

    try:
        for d in range(DIRECTIONS):
            # Screen-clockwise turn = clockwise seen from above = negative Z rotation
            turn = headings[d] - headings[0]
            tt.rotation_euler[2] = start_yaw - math.radians(turn)
            for i, f in enumerate(range(f0, f1 + 1)):
                scene.frame_set(f)
                scene.render.filepath = os.path.join(out_dir, f"{NAME}_d{d:02d}_f{i:03d}.png")
                bpy.ops.render.render(write_still=True)
            print(f"direction {d + 1}/{DIRECTIONS} done")
    finally:
        tt.rotation_euler[2] = start_yaw

    # The world origin (the unit's feet) projects to the centre of an ortho camera aimed at it.
    manifest = {
        "tool": "blender",
        "name": NAME,
        "directions": DIRECTIONS,
        "frames": n_frames,
        "width": RESOLUTION,
        "height": RESOLUTION,
        "originX": RESOLUTION / 2,
        "originY": RESOLUTION / 2,
        "fps": scene.render.fps,
    }
    with open(os.path.join(out_dir, "d2_render.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"Rendered {DIRECTIONS} directions x {n_frames} frames to {out_dir}")


main()
