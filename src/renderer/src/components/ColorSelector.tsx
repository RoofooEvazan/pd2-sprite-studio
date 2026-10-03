import { useEffect, useMemo, useRef, useState } from 'react'
import { hexToRgb, Hsv, hsvToRgb, nearestIndices, paletteRgb, rgbToHex, rgbToHsv, shadeRamp } from '../../../core/color'
import { paletteToHex } from '../../../core/palette'
import { palette, setState, useStore } from '../store'

const SV_W = 196
const SV_H = 110

/**
 * Free colour picker (HSV / hex / RGB) that snaps to the game palette: shows the closest palette
 * entries to the chosen colour, plus a light-to-dark shading ramp for the active colour.
 */
export function ColorSelector() {
  const primary = useStore((s) => s.primary)
  const secondary = useStore((s) => s.secondary)
  const paletteName = useStore((s) => s.paletteName)
  const pal = palette()
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(paletteRgb(pal, primary || 1)))
  const [hexText, setHexText] = useState('')
  const svRef = useRef<HTMLCanvasElement>(null)
  const hueRef = useRef<HTMLCanvasElement>(null)
  const ownChange = useRef(false)

  // Follow the active colour when it is chosen elsewhere (swatches, picker tool)
  useEffect(() => {
    if (ownChange.current) {
      ownChange.current = false
      return
    }
    if (primary) setHsv(rgbToHsv(paletteRgb(pal, primary)))
  }, [primary, paletteName]) // eslint-disable-line react-hooks/exhaustive-deps

  const rgb = hsvToRgb(hsv)
  const hex = rgbToHex(rgb)
  useEffect(() => setHexText(hex), [hex])

  const matches = useMemo(() => nearestIndices(pal, rgb, 8), [pal, hex]) // eslint-disable-line react-hooks/exhaustive-deps
  const ramp = useMemo(() => shadeRamp(pal, primary), [pal, primary])

  useEffect(() => {
    const c = svRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(SV_W, SV_H)
    for (let y = 0; y < SV_H; y++)
      for (let x = 0; x < SV_W; x++) {
        const [r, g, b] = hsvToRgb([hsv[0], x / (SV_W - 1), 1 - y / (SV_H - 1)])
        const o = (y * SV_W + x) * 4
        img.data[o] = r
        img.data[o + 1] = g
        img.data[o + 2] = b
        img.data[o + 3] = 255
      }
    ctx.putImageData(img, 0, 0)
    // Mark where palette colours of this hue sit, so it's clear what's reachable
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    for (let i = 1; i < 256; i++) {
      const [h, s, v] = rgbToHsv(paletteRgb(pal, i))
      let dh = Math.abs(h - hsv[0])
      if (dh > 180) dh = 360 - dh
      if (dh > 12 && s > 0.12) continue
      ctx.fillRect(Math.round(s * (SV_W - 1)) - 1, Math.round((1 - v) * (SV_H - 1)) - 1, 3, 3)
    }
  }, [hsv[0], pal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = hueRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    for (let x = 0; x < SV_W; x++) {
      ctx.fillStyle = rgbToHex(hsvToRgb([(x / SV_W) * 360, 1, 1]))
      ctx.fillRect(x, 0, 1, 12)
    }
  }, [])

  const drag = (el: HTMLElement, e: React.MouseEvent, fn: (fx: number, fy: number) => void) => {
    const move = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
    }
    move(e.nativeEvent)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const choose = (index: number, button: number) => {
    ownChange.current = button !== 2
    setState(button === 2 ? { secondary: index } : { primary: index })
  }

  const setRgb = (next: [number, number, number]) => setHsv(rgbToHsv(next))

  return (
    <div className="color-selector">
      <div className="cs-picker">
        <div className="cs-sv-wrap">
          <canvas ref={svRef} width={SV_W} height={SV_H} className="cs-sv" onMouseDown={(e) => drag(svRef.current!, e, (fx, fy) => setHsv([hsv[0], fx, 1 - fy]))} />
          <div className="cs-sv-dot" style={{ left: hsv[1] * (SV_W - 1), top: (1 - hsv[2]) * (SV_H - 1), background: hex }} />
        </div>
        <div className="cs-hue-wrap">
          <canvas ref={hueRef} width={SV_W} height={12} className="cs-hue" onMouseDown={(e) => drag(hueRef.current!, e, (fx) => setHsv([fx * 359.9, hsv[1], hsv[2]]))} />
          <div className="cs-hue-dot" style={{ left: (hsv[0] / 360) * SV_W }} />
        </div>
      </div>
      <div className="cs-fields">
        <div className="cs-target" style={{ background: hex }} title="Chosen colour (before snapping to the palette)" />
        <input
          className="cs-hex"
          value={hexText}
          onChange={(e) => {
            setHexText(e.target.value)
            const v = hexToRgb(e.target.value)
            if (v) setRgb(v)
          }}
        />
        {(['R', 'G', 'B'] as const).map((ch, k) => (
          <label key={ch} className="cs-ch">
            {ch}
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[k]}
              onChange={(e) => {
                const next = [...rgb] as [number, number, number]
                next[k] = Math.max(0, Math.min(255, +e.target.value || 0))
                setRgb(next)
              }}
            />
          </label>
        ))}
      </div>
      <div className="cs-label small muted">Closest palette colours. Left-click or right-click to use one.</div>
      <div className="cs-matches">
        {matches.map((m, i) => (
          <button
            key={m.index}
            className={`cs-match${m.index === primary ? ' p' : ''}${m.index === secondary ? ' s' : ''}`}
            style={{ background: paletteToHex(pal, m.index) }}
            title={`Index ${m.index} · ${paletteToHex(pal, m.index)} · ΔE ${m.dist.toFixed(1)}${i === 0 ? ' (closest)' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(m.index, e.button)
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {i === 0 && <span className="cs-best">★</span>}
          </button>
        ))}
        <span className={`cs-de small ${matches[0]?.dist < 5 ? 'good' : matches[0]?.dist < 12 ? 'ok' : 'bad'}`} title="Perceptual distance (ΔE) of the closest match: under 5 is barely visible">
          ΔE {matches[0]?.dist.toFixed(1)}
        </span>
      </div>
      {ramp.length > 1 && (
        <>
          <div className="cs-label small muted">Shading ramp for colour {primary}, light to dark</div>
          <div className="cs-ramp">
            {ramp.map((i) => (
              <button
                key={i}
                className={`cs-ramp-sw${i === primary ? ' p' : ''}${i === secondary ? ' s' : ''}`}
                style={{ background: paletteToHex(pal, i) }}
                title={`Index ${i} · ${paletteToHex(pal, i)}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(i, e.button)
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
