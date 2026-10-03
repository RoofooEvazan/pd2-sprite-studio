// Shared UI building blocks.

import { ReactNode, useEffect, useRef, useState } from 'react'
import type { Icon } from '@tabler/icons-react'
import type { AnimPreview } from './thumbs'

export function IconButton({
  icon: I,
  label,
  onClick,
  active,
  disabled,
  tip,
  size = 18,
  className = '',
  showLabel = false
}: {
  icon: Icon
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  tip?: string
  size?: number
  className?: string
  showLabel?: boolean
}) {
  return (
    <button className={`ibtn${active ? ' on' : ''}${showLabel ? ' labelled' : ''} ${className}`} aria-label={label} data-tip={tip ?? (showLabel ? undefined : label)} onClick={onClick} disabled={disabled}>
      <I size={size} stroke={1.75} />
      {showLabel && <span>{label}</span>}
    </button>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  small
}: {
  options: { value: T; label: ReactNode; tip?: string }[]
  value: T
  onChange: (v: T) => void
  small?: boolean
}) {
  return (
    <div className={`seg-group${small ? ' small' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} data-tip={o.tip} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Click-to-open popover anchored under its trigger; closes on outside click or Escape. */
export function Popover({ trigger, children, align = 'left', width }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="pop-anchor" ref={ref}>
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div className={`popover ${align}`} style={width ? { width } : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon: I, label, hint, onClick, danger }: { icon?: Icon; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick}>
      {I ? <I size={17} stroke={1.75} /> : <span style={{ width: 17 }} />}
      <span className="mi-text">
        <span>{label}</span>
        {hint && <span className="mi-hint">{hint}</span>}
      </span>
    </button>
  )
}

/** Renders children only once scrolled into view. */
export function useVisible<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        setVisible(true)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return [ref, visible]
}

/** Lazily loaded picture (data URL from an async loader). */
export function LazyImg({ load, className = '', alt = '' }: { load: () => Promise<string | null>; className?: string; alt?: string }) {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!visible) return
    let live = true
    load().then((u) => live && setUrl(u))
    return () => {
      live = false
    }
  }, [visible]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={`lazy-img ${className}`}>
      {url ? <img src={url} alt={alt} /> : url === null ? <span className="lazy-missing">no preview</span> : <span className="lazy-spin" />}
    </div>
  )
}

/** Plays a small animated preview. */
export function AnimCanvas({ preview, scale = 2, playing = true }: { preview: AnimPreview | null; scale?: number; playing?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !preview || !preview.frames.length) return
    const f0 = preview.frames[0]
    c.width = Math.max(1, f0.width)
    c.height = Math.max(1, f0.height)
    const ctx = c.getContext('2d')!
    let i = 0
    let raf = 0
    let last = performance.now()
    let acc = 0
    const draw = () => ctx.putImageData(new ImageData(preview.frames[i].data, c.width, c.height), 0, 0)
    draw()
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * preview.fps
      last = now
      if (acc >= 1) {
        i = (i + Math.floor(acc)) % preview.frames.length
        acc %= 1
        draw()
      }
      raf = requestAnimationFrame(tick)
    }
    if (playing) raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [preview, playing])
  if (!preview) return <span className="lazy-spin" />
  const f0 = preview.frames[0]
  return <canvas ref={ref} className="anim-canvas" style={{ width: (f0?.width ?? 1) * scale, height: (f0?.height ?? 1) * scale }} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
