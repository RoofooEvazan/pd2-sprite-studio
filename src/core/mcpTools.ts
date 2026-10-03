// Tools PD2 Sprite Studio offers to AI assistants over MCP (Model Context Protocol).
// Shared by the main process (which lists them) and the renderer (which runs them against the open app).

export interface McpTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const int = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'integer', description, ...extra })
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'number', description, ...extra })
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const bool = (description: string) => ({ type: 'boolean', description })
const obj = (properties: Record<string, unknown>, required?: string[]): McpTool['inputSchema'] => ({ type: 'object', properties, ...(required ? { required } : {}) })

const SCOPE = str('Which frames to change: this frame, every frame of this direction, or every direction', { enum: ['frame', 'direction', 'all'], default: 'frame' })
const DIR = int('Direction (facing) index; defaults to the one shown in the editor')
const FRAME = int('Frame index (0-based); defaults to the one shown in the editor')
const ROLE = str('What the part becomes', { enum: ['floor', 'wall', 'lower', 'roof', 'ignore'] })

export const MCP_INSTRUCTIONS = `PD2 Sprite Studio edits Project Diablo 2 sprites and builds map tiles. You are driving the user's open app: they see every change live, and each edit is one undo step.

Sprites are palette-indexed: every pixel is a palette index 0-255 and 0 is transparent. Use \`palette\` to find indices for colours. Coordinates are sprite-space: (0,0) is the unit's ground point (feet) for animations; frames have an offset, so read \`view_frame\`/\`read_pixels\` output for bounds.

Typical sprite flow: search_sprites → open_animation or open_item → view_frame → edit (recolor_material, replace_color, draw_pixels, draw_shape, import_image) → transfer_edits to carry a frame's edits to the other frames → view_frame / view_sheet to check → export_pd2.
Prefer the high-level tools (recolor_material, transfer_edits, outline) over many single pixels: they keep the game's shading.

Map tile flow (Tile Maker): tiles_add_block or tiles_import_model → tiles_list_parts / tiles_set_role → tiles_settings → tiles_split (returns the map drawn as the game draws it) → tiles_save. 1 world unit = 1 map tile; Y is up; the ground is Y = 0; walls should sit on whole-tile grid lines; parts below the ground become lower walls (cliffs).

Use screenshot_app whenever you need to see the whole window.`

export const MCP_TOOLS: McpTool[] = [
  // ---------------------------------------------------------------- general
  { name: 'get_state', description: 'What the app is showing: screen, open sprite (layers, directions, frames, palette), current direction/frame, export folder and Tile Maker scene.', inputSchema: obj({}) },
  { name: 'screenshot_app', description: 'Screenshot of the whole app window as the user sees it.', inputSchema: obj({}) },
  {
    name: 'go_to_screen',
    description: 'Switch the app to a screen.',
    inputSchema: obj({ screen: str('Screen', { enum: ['home', 'editor', 'chars', 'monsters', 'objects', 'items', 'tiles', '3d'] }) }, ['screen'])
  },

  // ---------------------------------------------------------------- sprites
  {
    name: 'search_sprites',
    description: 'Search the sprite database: animated units (characters, monsters, objects) and item inventory graphics.',
    inputSchema: obj({
      query: str('Words to match in names, codes or tokens (e.g. "skeleton", "amazon", "crown", "hax")'),
      kind: str('What to search', { enum: ['any', 'units', 'items'], default: 'any' }),
      limit: int('Maximum results (default 20)')
    })
  },
  {
    name: 'open_item',
    description: 'Open an item inventory graphic (DC6) in the editor.',
    inputSchema: obj({
      path: str('Archive path from search_sprites, e.g. data\\global\\items\\invcap.dc6'),
      code: str('Or the item code, e.g. "cap"'),
      discard_changes: bool('Open even if the current sprite has unsaved edits (they are lost)')
    })
  },
  {
    name: 'open_animation',
    description: 'Open a unit animation (all its COF layers) in the editor.',
    inputSchema: obj(
      {
        token: str('Unit token from search_sprites, e.g. "AM" (Amazon), "SK" (skeleton)'),
        base: str('chars, monsters or objects, if the token exists in more than one', { enum: ['chars', 'monsters', 'objects'] }),
        mode: str('Animation mode, e.g. NU (neutral), WL (walk), RN (run), A1 (attack), SC (cast), GH (hit), DT (death)'),
        weapon_class: str('Weapon class, e.g. HTH, 1HS, 2HS, BOW (see search_sprites output); defaults to the first available'),
        discard_changes: bool('Open even if the current sprite has unsaved edits (they are lost)')
      },
      ['token', 'mode']
    )
  },
  {
    name: 'set_layer',
    description: 'Animation only: choose which body part you edit, and optionally its style (armtype, e.g. LIT/MED/HVY or a weapon code), visibility, or a new custom style code to save it under.',
    inputSchema: obj(
      {
        part: str('Body part code: HD head, TR torso, LG legs, RA/LA arms, RH/LH hands, SH shield, S1-S8 specials'),
        style: str('Load this existing style for the part (replaces unsaved edits on that part)'),
        save_as_style: str('Export the edited part under this new 1-3 letter style code'),
        visible: bool('Show or hide the part')
      },
      ['part']
    )
  },
  {
    name: 'view_frame',
    description: 'Picture of a frame: the active layer alone or all layers composited as in the game. Also returns the frame bounds in sprite coordinates.',
    inputSchema: obj({
      direction: DIR,
      frame: FRAME,
      what: str('Active layer only, or every layer as the game draws it', { enum: ['layer', 'composite'], default: 'layer' }),
      scale: int('Pixel magnification 1-8 (default: fit to about 400 px)'),
      original: bool('Show the unedited game version instead')
    })
  },
  {
    name: 'view_sheet',
    description: 'One picture of many frames side by side: every frame of a direction, or frame N of every direction.',
    inputSchema: obj({
      layout: str('Which frames', { enum: ['direction_frames', 'all_directions'], default: 'direction_frames' }),
      direction: DIR,
      frame: FRAME,
      what: str('Active layer only or all layers', { enum: ['layer', 'composite'], default: 'composite' }),
      scale: int('Pixel magnification 1-4 (default 2)')
    })
  },
  {
    name: 'read_pixels',
    description: 'Palette indices of a frame region (max 96×96), one row per line, "." for transparent. Coordinates are sprite-space.',
    inputSchema: obj({ direction: DIR, frame: FRAME, x: int('Left (default: frame left)'), y: int('Top (default: frame top)'), width: int('Width'), height: int('Height') })
  },
  {
    name: 'palette',
    description: 'The active palette. With near_hex, the closest palette indices to a colour; with index, the shading ramp that index belongs to. Without arguments, all 256 colours.',
    inputSchema: obj({
      near_hex: str('Colour like #a03020'),
      index: int('Palette index to get the ramp (light→dark shades) for'),
      name: str('Switch palette (ACT1-ACT5, UNITS, …) for viewing and colour matching')
    })
  },
  {
    name: 'draw_pixels',
    description: 'Set individual pixels on the active layer (sprite-space coordinates; index 0 erases). Animation frames grow to fit; item frames are clipped to their size.',
    inputSchema: obj(
      {
        direction: DIR,
        frame: FRAME,
        pixels: { type: 'array', description: 'List of [x, y, paletteIndex]', items: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 } }
      },
      ['pixels']
    )
  },
  {
    name: 'draw_shape',
    description: 'Draw a line or rectangle, or flood-fill, with one palette index on the active layer (sprite-space coordinates).',
    inputSchema: obj(
      {
        shape: str('What to draw', { enum: ['line', 'rect', 'filled_rect', 'fill', 'fill_all_matching'] }),
        x0: int('Start x (or the fill point)'),
        y0: int('Start y (or the fill point)'),
        x1: int('End x (line/rect)'),
        y1: int('End y (line/rect)'),
        index: int('Palette index (0 erases)'),
        size: int('Line thickness (default 1)'),
        direction: DIR,
        frame: FRAME
      },
      ['shape', 'x0', 'y0', 'index']
    )
  },
  {
    name: 'replace_color',
    description: 'Replace every pixel of one palette index with another.',
    inputSchema: obj({ from: int('Palette index to replace'), to: int('New palette index'), scope: SCOPE }, ['from', 'to'])
  },
  {
    name: 'recolor_material',
    description: 'Recolour a whole material while keeping its shading: every shade of from_index\'s ramp maps onto the matching shade of to_index\'s ramp (e.g. turn red cloth blue). Best tool for colour variants.',
    inputSchema: obj({ from_index: int('Any palette index of the material to recolour'), to_index: int('Any palette index of the target colour'), scope: SCOPE }, ['from_index', 'to_index'])
  },
  {
    name: 'hsv_shift',
    description: 'Shift hue/saturation/brightness of the listed palette indices (each re-matched to the palette).',
    inputSchema: obj(
      {
        indices: { type: 'array', items: { type: 'integer' }, description: 'Palette indices to change' },
        hue: num('Hue shift in degrees (-180..180)'),
        saturation: num('Saturation multiplier (1 = unchanged)'),
        value: num('Brightness change (-1..1)'),
        scope: SCOPE
      },
      ['indices']
    )
  },
  {
    name: 'outline',
    description: 'Clean-up tools: add a 1 px outline (auto-shaded or one colour), darken edges, or remove stray pixels and fill pinholes.',
    inputSchema: obj(
      { action: str('What to do', { enum: ['outline', 'darken_edges', 'remove_strays'] }), index: int('Outline colour (default: auto, the darkest shade of each neighbour)'), scope: SCOPE },
      ['action']
    )
  },
  {
    name: 'transfer_edits',
    description: 'Carry the edits made on one frame (compared with how it looked before editing) to other frames, tracking moving parts. Applies the result as one undo step and returns a sheet of the changed frames.',
    inputSchema: obj({
      direction: DIR,
      frame: FRAME,
      to: str('Target frames', { enum: ['following', 'direction', 'all_directions'], default: 'direction' }),
      mode: str('auto picks: track (moving edits), recolor (colour swaps), fixed (same position)', { enum: ['auto', 'track', 'recolor', 'fixed'], default: 'auto' })
    })
  },
  {
    name: 'import_image',
    description: 'Put a PNG/JPEG/GIF/BMP/WebP file from disk into a frame, matching colours to the palette. The image\'s top-left goes at (x, y) sprite-space (default: the frame\'s current top-left).',
    inputSchema: obj(
      {
        path: str('Absolute path of the image file'),
        direction: DIR,
        frame: FRAME,
        x: int('Left'),
        y: int('Top'),
        blend: str("over: paint the image's opaque pixels onto the frame; replace: the image becomes the whole frame", { enum: ['over', 'replace'], default: 'over' })
      },
      ['path']
    )
  },
  { name: 'undo', description: 'Undo the last edit.', inputSchema: obj({ steps: int('How many steps (default 1)') }) },
  { name: 'redo', description: 'Redo the last undone edit.', inputSchema: obj({ steps: int('How many steps (default 1)') }) },
  {
    name: 'export_pd2',
    description: 'Save the edited sprite in the game\'s format (DC6 for items, DCC per edited body part plus optionally the COF) under data\\global\\… in the export folder.',
    inputSchema: obj({ include_cof: bool('Also write the animation\'s COF'), all_parts: bool('Write every body part, not only edited ones') })
  },
  {
    name: 'export_image',
    description: 'Save a PNG of a frame, a PNG sheet, or an animated GIF into the export folder (mcp-output\\).',
    inputSchema: obj(
      {
        format: str('What to save', { enum: ['png', 'sheet', 'gif'] }),
        name: str('File name without extension'),
        direction: DIR,
        frame: FRAME,
        scale: int('Magnification 1-8 (default 1)')
      },
      ['format']
    )
  },

  // ---------------------------------------------------------------- tile maker
  {
    name: 'tiles_add_block',
    description: 'Tile Maker: add a solid block to the scene (units are map tiles, Y up, ground at Y=0). Use walls ~0.1-0.2 thick standing on whole-tile grid lines, floors as thin slabs whose top is at Y=0.',
    inputSchema: obj(
      {
        shape: str('Block shape', { enum: ['box', 'cylinder', 'cone', 'sphere', 'ramp'] }),
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z] of the block\'s minimum corner' },
        size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[width along X, height along Y, depth along Z] in tiles' },
        color: str('Colour like #8a7f6a'),
        role: ROLE,
        name: str('Part name'),
        rotation_y: num('Turn around the vertical axis in degrees')
      },
      ['shape', 'position', 'size']
    )
  },
  {
    name: 'tiles_import_model',
    description: 'Tile Maker: import a GLB/glTF (Blender), FBX (3ds Max) or OBJ scene from disk. Units are auto-detected and the main floor is put at ground level.',
    inputSchema: obj({ path: str('Absolute path of the model file'), units_per_tile: num('Override: model units per map tile') }, ['path'])
  },
  { name: 'tiles_list_parts', description: 'Tile Maker: every part with its index, role and size/position in tiles.', inputSchema: obj({}) },
  {
    name: 'tiles_set_role',
    description: 'Tile Maker: set what a part becomes.',
    inputSchema: obj({ part: int('Part index from tiles_list_parts'), name_contains: str('Or: every part whose name contains this text'), role: ROLE }, ['role'])
  },
  { name: 'tiles_clear', description: 'Tile Maker: remove everything from the scene.', inputSchema: obj({}) },
  {
    name: 'tiles_settings',
    description: 'Tile Maker: map size, act palette, tile set name, start index, lighting and dithering. Returns the current settings.',
    inputSchema: obj({
      map_width: int('Map width in tiles (1-20)'),
      map_height: int('Map height in tiles (1-20)'),
      fit_to_scene: bool('Size the map to the scene'),
      act: int('Act 1-5 (palette)'),
      name: str('Tile set name (letters, digits, _)'),
      start_index: int('Main index 0-63'),
      lighting: str('Lighting', { enum: ['diablo', 'bright', 'dungeon'] }),
      dither: bool('Dither gradients'),
      color_by_role: bool('Tint the 3D view by role')
    })
  },
  {
    name: 'tiles_split',
    description: 'Tile Maker: render and split the scene into DT1 tiles + a DS1 map. Returns tile counts and the map drawn with the game\'s rules. Call tiles_save to write the files.',
    inputSchema: obj({ one_file: bool('Put every tile in one DT1 instead of floor/walls/roof files') })
  },
  { name: 'tiles_save', description: 'Tile Maker: save the last split (DT1s + DS1) into the export folder.', inputSchema: obj({}) }
]
