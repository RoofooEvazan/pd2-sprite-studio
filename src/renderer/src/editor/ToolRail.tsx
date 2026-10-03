import type { Icon } from '@tabler/icons-react'
import {
  IconArrowsMove,
  IconArrowsRightLeft,
  IconBorderOuter,
  IconBucketDroplet,
  IconColorPicker,
  IconContrast2,
  IconCube,
  IconRotate360,
  IconCopy,
  IconDots,
  IconEraser,
  IconMarquee2,
  IconPalette,
  IconPencil,
  IconPhoto,
  IconRepeat,
  IconShape
} from '@tabler/icons-react'
import { getFrame, getState, commitFrame, revertActive, setState, Tool, useStore } from '../store'
import { MenuItem, Popover } from '../ui'
import { cloneFrame } from '../../../core/sprite'
import { importImageIntoFrame } from '../importImage'

export interface ToolGroup {
  id: string
  label: string
  icon: Icon
  tools: Tool[]
  key: string
  tip: string
}

export const GROUPS: ToolGroup[] = [
  { id: 'draw', label: 'Draw', icon: IconPencil, tools: ['pencil'], key: 'B', tip: 'Paint pixels in the chosen colour' },
  { id: 'erase', label: 'Erase', icon: IconEraser, tools: ['eraser'], key: 'E', tip: 'Make pixels transparent' },
  { id: 'shade', label: 'Shade', icon: IconContrast2, tools: ['shade'], key: 'D', tip: 'Drag to lighten, right-drag to darken, keeping the same colour family' },
  { id: 'recolour', label: 'Recolour', icon: IconPalette, tools: ['ramp', 'replace'], key: 'J', tip: 'Change the colour of a whole material or one colour' },
  { id: 'fill', label: 'Fill', icon: IconBucketDroplet, tools: ['fill', 'fillAll'], key: 'G', tip: 'Fill an area with colour' },
  { id: 'select', label: 'Select', icon: IconMarquee2, tools: ['select', 'lasso', 'wand'], key: 'S', tip: 'Select pixels to move, copy, flip or mirror' },
  { id: 'pick', label: 'Pick', icon: IconColorPicker, tools: ['picker'], key: 'I', tip: 'Pick a colour from the sprite' },
  { id: 'shapes', label: 'Shapes', icon: IconShape, tools: ['line', 'rect', 'rectFill'], key: 'L', tip: 'Lines and boxes' },
  { id: 'move', label: 'Move', icon: IconArrowsMove, tools: ['move'], key: 'M', tip: 'Drag to shift the whole frame' }
]

export function groupOf(tool: Tool): ToolGroup {
  return GROUPS.find((g) => g.tools.includes(tool)) ?? GROUPS[0]
}

export function ToolRail() {
  const tool = useStore((s) => s.tool)
  const doc = useStore((s) => s.doc)
  const active = groupOf(tool)
  const lastInGroup = (g: ToolGroup) => (g.tools.includes(tool) ? tool : (lastUsed.get(g.id) ?? g.tools[0]))
  return (
    <div className="tool-rail">
      {GROUPS.map((g) => (
        <button
          key={g.id}
          className={`rail-btn${active.id === g.id ? ' on' : ''}`}
          data-tip={`${g.tip} (${g.key})`}
          data-tip-side="right"
          onClick={() => {
            const t = lastInGroup(g)
            lastUsed.set(g.id, t)
            setState({ tool: t })
          }}
        >
          <g.icon size={21} stroke={1.6} />
          <span>{g.label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
      <Popover
        trigger={(open, toggle) => (
          <button className={`rail-btn${open ? ' on' : ''}`} onClick={toggle} data-tip="More tools" data-tip-side="right">
            <IconDots size={21} stroke={1.6} />
            <span>More</span>
          </button>
        )}
        width={290}
      >
        {(close) => (
          <div className="rail-menu">
            {doc?.kind === 'anim' && (
              <MenuItem icon={IconRepeat} label="Copy my changes to other frames" hint="Tracks the edited area through the animation" onClick={() => (close(), setState({ showTransfer: true }))} />
            )}
            <MenuItem icon={IconRotate360} label="Open the 3D Studio" hint="Load a 3D model and render it straight into this sprite" onClick={() => (close(), setState({ screen: '3d' }))} />
            {doc?.kind === 'anim' && (
              <MenuItem icon={IconCube} label="Import 3D renders…" hint="Turn Blender or 3ds Max renders into a body part" onClick={() => (close(), setState({ renderImport: { composit: doc.active } }))} />
            )}
            <MenuItem icon={IconBorderOuter} label="Outline and clean up" hint="Add dark edges, remove stray pixels" onClick={() => (close(), setState({ showOutline: true }))} />
            <MenuItem
              icon={IconCopy}
              label="Copy the previous frame here"
              onClick={() => {
                close()
                const s = getState()
                const n = s.doc?.kind === 'anim' ? s.doc.cof.framesPerDir : (s.doc?.kind === 'item' ? s.doc.sprite.framesPerDir : 1)
                const cur = getFrame()
                const prev = getFrame(s.dir, (s.frame - 1 + n) % n)
                if (cur && prev && n > 1) commitFrame(s.dir, s.frame, cloneFrame(cur), cloneFrame(prev))
              }}
            />
            <MenuItem icon={IconPhoto} label="Import a picture into this frame" hint="PNG or JPEG, matched to the game colours" onClick={() => (close(), importImageIntoFrame())} />
            <MenuItem icon={IconArrowsRightLeft} label="Revert to the original" hint="Undo every change to this part" danger onClick={() => (close(), revertActive())} />
          </div>
        )}
      </Popover>
    </div>
  )
}

const lastUsed = new Map<string, Tool>()
