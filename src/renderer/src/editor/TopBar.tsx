import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronRight,
  IconDeviceFloppy,
  IconEye,
  IconGif,
  IconHome,
  IconLayersSubtract,
  IconLayoutGrid,
  IconPhoto,
  IconPhotoScan,
  IconSettings
} from '@tabler/icons-react'
import { goTo, redo, setState, undo, useStore } from '../store'
import { IconButton, MenuItem, Popover } from '../ui'
import { modeName, weaponName } from '../names'

export function TopBar({ onSettings }: { onSettings: () => void }) {
  const doc = useStore((s) => s.doc)
  const canUndo = useStore((s) => s.undo.length > 0 || !!s.floating)
  const canRedo = useStore((s) => s.redo.length > 0)
  const diff = useStore((s) => s.view.diff)
  useStore((s) => s.version)
  if (!doc) return null
  const dirty = doc.kind === 'item' ? doc.dirty : doc.layers.some((l) => l.dirty)
  const openPictures = () => setState({ showExport: true, exportMode: 'pictures' })

  return (
    <div className="topbar">
      <IconButton icon={IconHome} label="Home" tip="Home: pick something else to edit" onClick={() => goTo('home')} />
      <nav className="crumbs">
        {doc.kind === 'anim' ? (
          <>
            <button className="crumb" onClick={() => setState({ screen: doc.unit.base === 'chars' ? 'chars' : doc.unit.base === 'monsters' ? 'monsters' : 'objects', pickUnit: null })}>
              {doc.unit.base === 'chars' ? 'Characters' : doc.unit.base === 'monsters' ? 'Monsters' : 'Objects'}
            </button>
            <IconChevronRight size={14} className="muted" />
            <button className="crumb" onClick={() => setState({ screen: doc.unit.base === 'chars' ? 'chars' : doc.unit.base === 'monsters' ? 'monsters' : 'objects', pickUnit: doc.unit })} data-tip="Choose a different animation">
              {doc.unit.label}
            </button>
            <IconChevronRight size={14} className="muted" />
            <span className="crumb current" title={`${doc.mode} ${doc.wclass}`}>
              {modeName(doc.mode)}
              {doc.wclass !== 'HTH' || (doc.unit.modes[doc.mode]?.length ?? 0) > 1 ? <span className="muted"> · {weaponName(doc.wclass).toLowerCase()}</span> : null}
            </span>
          </>
        ) : (
          <>
            <button className="crumb" onClick={() => goTo('items')}>
              Items
            </button>
            <IconChevronRight size={14} className="muted" />
            <span className="crumb current">{doc.title}</span>
          </>
        )}
        {dirty && <span className="edited-dot" data-tip="You have changes that aren't saved to the game yet">Edited</span>}
      </nav>
      <div className="topbar-actions">
        <IconButton icon={IconArrowBackUp} label="Undo" tip="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconButton icon={IconArrowForwardUp} label="Redo" tip="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo} />
        <span className="sep" />
        <button
          className="ibtn labelled"
          data-tip="Hold to see the original game picture (or hold the \ key)"
          onMouseDown={() => setState({ showOriginal: true })}
          onMouseUp={() => setState({ showOriginal: false })}
          onMouseLeave={() => setState({ showOriginal: false })}
        >
          <IconEye size={18} stroke={1.75} />
          <span>Compare</span>
        </button>
        <IconButton
          icon={IconLayersSubtract}
          label="Changes"
          showLabel
          active={diff}
          tip="Highlight every pixel you've changed"
          onClick={() => setState((s) => ({ view: { ...s.view, diff: !s.view.diff }, version: s.version + 1 }))}
        />
        <span className="sep" />
        <Popover
          align="right"
          width={260}
          trigger={(open, toggle) => (
            <button className={`ibtn labelled${open ? ' on' : ''}`} onClick={toggle}>
              <IconPhoto size={18} stroke={1.75} />
              <span>Save picture</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={IconPhoto} label="This frame as PNG or JPEG" onClick={() => (close(), openPictures())} />
              {doc.kind === 'anim' && <MenuItem icon={IconGif} label="Animated GIF" onClick={() => (close(), openPictures())} />}
              <MenuItem icon={IconLayoutGrid} label="Sprite sheet (every frame)" onClick={() => (close(), openPictures())} />
              {doc.kind === 'anim' && <MenuItem icon={IconPhotoScan} label="All frames in one picture" hint="Every frame at its in-game position" onClick={() => (close(), openPictures())} />}
            </>
          )}
        </Popover>
        <button className="primary-btn" onClick={() => setState({ showExport: true, exportMode: 'game' })} data-tip="Write your changes as game files">
          <IconDeviceFloppy size={18} stroke={1.75} /> Save to game
        </button>
        <IconButton icon={IconSettings} label="Settings" onClick={onSettings} />
      </div>
    </div>
  )
}
