# Tristram courtyard: a test scene for the Tile Maker

A ruined chapel courtyard on a cliff top, built to exercise every Tile Maker role.

| Role | Parts |
|---|---|
| **Floor** | Flagstone courtyard and a dirt path (`floor_*`) |
| **Wall** | West wall with a window and battlements, north wall with a doorway and a collapsed end, a balustrade on the cliff edge, two pillars, gravestones, barrels, a torch, an altar and the shrine post (`wall_*`, `pillar_*`, `grave_*`, `barrel_*`, …) |
| **Lower wall** | The two cliff faces under the front edges, with rock outcrops (`cliff_*`) |
| **Roof** | The shrine's pyramid roof and eaves (`roof_*`) |

Roles are guessed from the part names, so it should split without any setup.

## Files

- `tristram_courtyard.glb`: glTF with the textures inside. **Blender:** File › Import › glTF 2.0.
- `tristram_courtyard.obj` + `.mtl` + `textures/`: **3ds Max:** File › Import, and pick the `.obj`. Keep the `textures` folder next to it.
- `preview_roles.png`, `preview_game_render.png`: what the result should look like.

The scene's scale: **1 unit = 1 map tile**, so one Blender grid square is one tile. Y is up, and the courtyard floor is at Y = 0. The map piece is 6 × 6 tiles, and the cliffs drop 2 tiles below it.

## Testing it in PD2 Sprite Studio

1. Open the **Tile Maker** from the start screen, then click **Import from Blender or 3ds Max…** and pick `tristram_courtyard.glb` or the `.obj`.
2. It should read as **1 unit per tile**, sitting on a **7 × 7** grid. The extra row and column hold the cliffs under the edges.
3. Under **Parts**, tick **Colour the scene by role**. Floors should be green, walls gold, cliffs blue and the roof red (see `preview_roles.png`).
4. Click **Split into DT1 + DS1**. You should get:
   - **36 floor tiles**, 60 wall tiles, 14 lower-wall tiles and 9 roof tiles
   - `tristram_floor.dt1`, `tristram_walls.dt1`, `tristram_roof.dt1` and `tristram.ds1` (8 × 8)
   - a picture like `preview_game_render.png`
5. **Save DT1 + DS1** writes the files under `data\global\tiles\act1\<name>\`. Open the `.ds1` in ds1-studio to place the piece in a map.

## Things to try

- Move the scene a tile with the arrow buttons and split again. Walls must stay on the grid lines to split cleanly.
- Set a part to a different role, for example a gravestone to *Leave out*, and compare the result.
- Edit it in Blender or 3ds Max (add a wall, move the doorway), export it again and re-import it.
  - From Blender, export with File › Export › glTF 2.0 (.glb) and leave Compression off.
  - From 3ds Max, export FBX. Its units are usually centimetres; the Tile Maker guesses about 200 units per tile, which you can correct under *1 tile = N model units*.

Made by `scripts/makeDemoScene.ts` (`npx tsx scripts/makeDemoScene.ts`). The textures are procedural, so there are no game assets in it.
