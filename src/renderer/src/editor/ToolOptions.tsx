import { IconAdjustments, IconClipboard, IconCopy, IconFlipHorizontal, IconFlipVertical, IconSquareFilled, IconSquare, IconLine, IconX, IconArrowsRightLeft } from '@tabler/icons-react'
import { paletteToHex } from '../../../core/palette'
import {
  clearSelection,
  commitFloating,
  copySelection,
  flipFloating,
  pixLassoClose,
  pixLassoUndo,
  wallSlope,
  LockMode,
  palette,
  pasteClip,
  pasteToMirrorDirection,
  Scope,
  setState,
  Tool,
  useStore
} from '../store'
import { groupOf } from './ToolRail'
import { Kbd, Popover, Segmented } from '../ui'

const LOCK_OPTIONS: { value: LockMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Anywhere', hint: '' },
  { value: 'opaque', label: 'Existing pixels only', hint: 'Never adds pixels to empty space' },
  { value: 'transparent', label: 'Empty space only', hint: 'Paints behind the sprite' },
  { value: 'color', label: 'One colour only', hint: 'Alt+click the sprite to choose the colour' },
  { value: 'ramp', label: 'One material only', hint: 'Just that colour family, like the leather. Alt+click to choose' }
]

function Sizes() {
  const brush = useStore((s) => s.brush)
  return (
    <label className="opt">
      <span className="opt-label">Size</span>
      <Segmented small options={[1, 2, 3, 5].map((v) => ({ value: v, label: v }))} value={brush} onChange={(v) => setState({ brush: v })} />
    </label>
  )
}

function PaintOn() {
  const lock = useStore((s) => s.lock)
  const lockColor = useStore((s) => s.lockColor)
  const primary = useStore((s) => s.primary)
  const opt = LOCK_OPTIONS.find((o) => o.value === lock)!
  return (
    <label className="opt" data-tip={opt.hint || 'Limit which pixels your strokes can change'}>
      <span className="opt-label">Only paint on</span>
      <select value={lock} onChange={(e) => setState({ lock: e.target.value as LockMode, lockColor: lockColor || primary })}>
        {LOCK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {(lock === 'color' || lock === 'ramp') && (
        <button
          className={`mini-swatch${lockColor ? '' : ' transparent'}`}
          style={lockColor ? { background: paletteToHex(palette(), lockColor) } : undefined}
          data-tip="The locked colour. Alt+click the sprite to change it, or click here to use your current colour."
          onClick={() => setState({ lockColor: primary })}
        />
      )}
    </label>
  )
}

function ScopeOpt() {
  const scope = useStore((s) => s.scope)
  const doc = useStore((s) => s.doc)
  const multi = doc && (doc.kind === 'anim' || doc.sprite.frames.flat().length > 1)
  if (!multi) return null
  return (
    <label className="opt">
      <span className="opt-label">Apply to</span>
      <Segmented<Scope>
        small
        options={[
          { value: 'frame', label: 'This frame' },
          { value: 'dir', label: 'Every frame', tip: 'Every frame facing this way' },
          { value: 'all', label: 'Every facing', tip: 'Every frame in every direction' }
        ]}
        value={scope}
        onChange={(v) => setState({ scope: v })}
      />
    </label>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <span className="opt-hint">{children}</span>
}

export function ToolOptions() {
  const tool = useStore((s) => s.tool)
  const doc = useStore((s) => s.doc)
  const hasSel = useStore((s) => !!s.selection || !!s.floating)
  const floating = useStore((s) => !!s.floating)
  const hasClip = useStore((s) => !!s.clipboard)
  const pixLasso = useStore((s) => s.pixLasso)
  const wallTile = useStore((s) => s.doc?.kind === 'item' && !!s.doc.tile) && wallSlope() !== null
  const view = useStore((s) => s.view)
  const g = groupOf(tool)
  const set = (t: Tool) => setState({ tool: t })
  const setView = (k: keyof typeof view, v: boolean | number) => setState((s) => ({ view: { ...s.view, [k]: v }, version: s.version + 1 }))

  let body: React.ReactNode = null
  switch (g.id) {
    case 'draw':
    case 'erase':
      body = (
        <>
          <Sizes />
          <PaintOn />
          <Hint>
            Right-click draws with your second colour · <Kbd>Alt</Kbd>+click picks the “only paint on” colour
          </Hint>
        </>
      )
      break
    case 'shade':
      body = (
        <>
          <Sizes />
          <PaintOn />
          <Hint>Drag to lighten · right-drag to darken. Colours stay in the same family.</Hint>
        </>
      )
      break
    case 'recolour':
      body = (
        <>
          <Segmented
            small
            options={[
              { value: 'ramp', label: 'Whole material', tip: 'Recolour every shade of the material you click, keeping its shading' },
              { value: 'replace', label: 'One colour', tip: 'Swap exactly one colour for your current colour' }
            ]}
            value={tool === 'replace' ? 'replace' : 'ramp'}
            onChange={(v) => set(v as Tool)}
          />
          <ScopeOpt />
          <Hint>{tool === 'replace' ? 'Click a pixel: every pixel of that colour becomes your current colour.' : 'Click the material you want to recolour, e.g. the leather.'}</Hint>
        </>
      )
      break
    case 'fill':
      body = (
        <>
          <Segmented
            small
            options={[
              { value: 'fill', label: 'Connected area' },
              { value: 'fillAll', label: 'Every pixel of that colour' }
            ]}
            value={tool}
            onChange={(v) => set(v as Tool)}
          />
          {tool === 'fillAll' && <ScopeOpt />}
          <PaintOn />
        </>
      )
      break
    case 'select':
      body = (
        <>
          <Segmented
            small
            options={[
              { value: 'select', label: 'Box' },
              { value: 'lasso', label: 'Lasso', tip: 'Drag a freehand outline' },
              { value: 'pixlasso', label: 'Pixel lasso', tip: 'Click pixels one by one (or drag over them) to trace an outline; click the first pixel again to close the loop' },
              { value: 'wand', label: 'Magic wand', tip: 'Selects a same-coloured area. Ctrl+click selects that colour everywhere' }
            ]}
            value={tool}
            onChange={(v) => set(v as Tool)}
          />
          {hasSel && (
            <>
              <button className="chip-btn" onClick={copySelection} data-tip="Ctrl+C">
                <IconCopy size={15} /> Copy
              </button>
              <button className="chip-btn" onClick={() => flipFloating('h')} data-tip="H">
                <IconFlipVertical size={15} /> Flip sideways
              </button>
              <button className="chip-btn" onClick={() => flipFloating('v')} data-tip="V">
                <IconFlipHorizontal size={15} /> Flip upside down
              </button>
              {wallTile && (
                <button
                  className="chip-btn"
                  onClick={() => flipFloating('wall')}
                  data-tip="Mirror along the wall: left and right swap while everything stays on the wall's slant (e.g. an arch rising up-left now rises up-right)"
                >
                  <IconArrowsRightLeft size={15} /> Mirror along wall
                </button>
              )}
            </>
          )}
          {hasClip && (
            <button className="chip-btn" onClick={() => pasteClip()} data-tip="Ctrl+V. Pastes at the same spot, so you can copy a part to another frame.">
              <IconClipboard size={15} /> Paste
            </button>
          )}
          {doc?.kind === 'anim' && (
            <button className="chip-btn" onClick={pasteToMirrorDirection} data-tip="Copy this (or the whole frame) flipped into the opposite facing, e.g. down-left → down-right">
              <IconArrowsRightLeft size={15} /> Mirror to other side
            </button>
          )}
          {floating && (
            <button className="chip-btn accent" onClick={commitFloating} data-tip="Enter">
              Place
            </button>
          )}
          {hasSel && (
            <button className="chip-btn" onClick={clearSelection} data-tip="Ctrl+D">
              <IconX size={15} /> Deselect
            </button>
          )}
          {tool === 'pixlasso' && pixLasso && (
            <>
              <button className="chip-btn accent" onClick={pixLassoClose} data-tip="Enter">
                Close loop
              </button>
              <button className="chip-btn" onClick={pixLassoUndo} data-tip="Backspace or right-click">
                Undo point
              </button>
            </>
          )}
          {tool === 'pixlasso' && !pixLasso && !hasSel && (
            <Hint>Click pixels (or drag over them) to trace an outline · click the first pixel again to close · right-click removes a point</Hint>
          )}
          {tool !== 'pixlasso' && !hasSel && !hasClip && <Hint>Drag to select. Shift adds to the selection. Drag inside it to move.</Hint>}
        </>
      )
      break
    case 'pick':
      body = <Hint>Click to pick a colour · right-click picks your second colour</Hint>
      break
    case 'shapes':
      body = (
        <>
          <Segmented
            small
            options={[
              { value: 'line', label: <><IconLine size={15} /> Line</> },
              { value: 'rect', label: <><IconSquare size={15} /> Box</> },
              { value: 'rectFill', label: <><IconSquareFilled size={15} /> Filled box</> }
            ]}
            value={tool}
            onChange={(v) => set(v as Tool)}
          />
          {tool === 'line' && <Sizes />}
          <PaintOn />
        </>
      )
      break
    case 'move':
      body = <Hint>Drag to shift the whole frame. Useful for lining a part up with the body.</Hint>
      break
  }

  return (
    <div className="tool-options">
      <div className="to-title">{g.label}</div>
      <div className="to-body">{body}</div>
      <Popover
        align="right"
        width={270}
        trigger={(open, toggle) => (
          <button className={`ibtn labelled${open ? ' on' : ''}`} onClick={toggle}>
            <IconAdjustments size={18} stroke={1.75} />
            <span>View</span>
          </button>
        )}
      >
        {() => (
          <div className="view-menu">
            <label className="check-row">
              <input type="checkbox" checked={view.grid} onChange={(e) => setView('grid', e.target.checked)} /> Pixel grid
            </label>
            {doc?.kind === 'anim' && (
              <>
                <label className="check-row">
                  <input type="checkbox" checked={view.ghostLayers} onChange={(e) => setView('ghostLayers', e.target.checked)} /> Show the rest of the body
                </label>
                {view.ghostLayers && (
                  <label className="check-row sub">
                    Faded
                    <input type="range" min={0.1} max={1} step={0.05} value={view.ghostAlpha} onChange={(e) => setView('ghostAlpha', +e.target.value)} /> solid
                  </label>
                )}
                <label className="check-row">
                  <input type="checkbox" checked={view.onion} onChange={(e) => setView('onion', e.target.checked)} /> Show neighbouring frames faintly
                </label>
                <label className="check-row" data-tip="The game's animation format allows at most 4 colours per 4×4 block. Red boxes mark blocks that will be simplified when saved.">
                  <input type="checkbox" checked={view.cellWarn} onChange={(e) => setView('cellWarn', e.target.checked)} /> Colour-limit warnings
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={view.origin} onChange={(e) => setView('origin', e.target.checked)} /> Ground point marker
                </label>
              </>
            )}
          </div>
        )}
      </Popover>
    </div>
  )
}
