/*
  Diablo II sprite renderer for 3ds Max (MAXScript)
  ==================================================
  Renders your animated model the way Diablo II's own sprites were made: an orthographic camera
  looking down at 30 degrees (the game's 2:1 view), every facing, every frame, with alpha.
  PD2 Sprite Studio imports the folder this writes.

  How to use
  1. Put the model's feet at the world origin [0,0,0].
  2. Scripting > Run Script > this file, with doRender = false. It creates "D2_Camera" and a
     dummy "D2_Turntable".
  3. Link your model (and its bones/root) to D2_Turntable.
  4. Look through D2_Camera (press C) and rotate D2_Turntable around Z only so the model faces
     the BOTTOM-LEFT of the view. That's direction 0 in Diablo II.
  5. Set doRender = true below and run again. Frames render from the active time range.
  6. In PD2 Sprite Studio: More > Import 3D renders, and pick outputDir.

  Uses the Scanline renderer's alpha. With other renderers, make sure the background renders
  transparent and anti-aliasing is minimal.
*/

(
  -- SETTINGS -------------------------------------------------------------------------------
  local directions = 16            -- 16 for player characters, 8 for monsters
  local outputDir = (getDir #renderoutput) + "\\d2_renders"
  local spriteName = "sprite"
  local resolution = 192           -- square render size in pixels
  local orthoWidth = 300.0         -- world units visible across the picture (smaller = bigger model)
  local cameraDistance = 3000.0
  local sharpEdges = true
  local doRender = false
  -- -----------------------------------------------------------------------------------------

  -- Diablo II direction index -> screen heading (degrees, 0 = right, clockwise). 0 = bottom-left.
  local heading8 = #(135, 225, 315, 45, 90, 180, 270, 0)
  local heading16 = #(135, 225, 315, 45, 90, 180, 270, 0, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5, 22.5, 67.5)

  -- Camera: orthographic, tilted 60 deg from straight down (= 30 deg above the ground), turned 45 deg.
  local cam = getNodeByName "D2_Camera"
  if cam == undefined do cam = Freecamera name:"D2_Camera"
  cam.transform = matrix3 1
  rotate cam (eulerAngles 60 0 0)
  rotate cam (eulerAngles 0 0 45)
  -- A camera looks along its local -Z; node.dir is local +Z, so stepping back along dir faces the origin.
  cam.pos = cam.dir * cameraDistance
  cam.orthoProjection = true
  cam.targetDistance = cameraDistance
  cam.fov = 2.0 * (atan (orthoWidth / (2.0 * cameraDistance)))

  local tt = getNodeByName "D2_Turntable"
  if tt == undefined do tt = Dummy name:"D2_Turntable" pos:[0,0,0] boxsize:[40,40,40]

  renderWidth = resolution
  renderHeight = resolution

  if not doRender then
  (
    format "D2 camera and turntable ready. Link your model to D2_Turntable, face it bottom-left, then set doRender = true.\n"
  )
  else
  (
    if sharpEdges and (classOf renderers.current == Default_Scanline_Renderer) do renderers.current.antiAliasing = false
    pngio.setType #true32
    pngio.setAlpha true
    makeDir outputDir all:true
    local headings = if directions == 16 then heading16 else heading8
    local startTM = tt.transform
    local f0 = animationRange.start.frame as integer
    local f1 = animationRange.end.frame as integer
    local nFrames = f1 - f0 + 1
    for d = 1 to directions do
    (
      -- Screen-clockwise turn = clockwise seen from above = negative rotation about Z
      local turn = headings[d] - headings[1]
      tt.transform = (rotateZMatrix (-turn)) * startTM
      for f = f0 to f1 do
      (
        local fname = outputDir + "\\" + spriteName + "_d" + (formattedPrint (d - 1) format:"02d") + "_f" + (formattedPrint (f - f0) format:"03d") + ".png"
        local bm = render camera:cam frame:f outputwidth:resolution outputheight:resolution vfb:false
        bm.filename = fname
        save bm
        close bm
      )
      format "direction %/% done\n" d directions
    )
    tt.transform = startTM

    -- The world origin (the unit's feet) is at the centre of an ortho camera aimed at it.
    local fs = createFile (outputDir + "\\d2_render.json")
    format "{\n  \"tool\": \"3dsmax\",\n  \"name\": \"%\",\n  \"directions\": %,\n  \"frames\": %,\n  \"width\": %,\n  \"height\": %,\n  \"originX\": %,\n  \"originY\": %,\n  \"fps\": %\n}\n" spriteName directions nFrames resolution resolution (resolution / 2.0) (resolution / 2.0) frameRate to:fs
    close fs
    format "Rendered % directions x % frames to %\n" directions nFrames outputDir
  )
)
