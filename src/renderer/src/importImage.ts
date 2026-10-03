import { nearestIndex } from '../../core/palette'
import { cloneFrame, Frame, trimFrame } from '../../core/sprite'
import { api } from './api'
import { decodeImage } from './imageExport'
import { commitFrame, getFrame, getState, palette, toast } from './store'

/** Load a picture file into the current frame, matching colours to the active palette. */
export async function importImageIntoFrame(): Promise<void> {
  const file = await api.openFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }])
  if (!file) return
  const s = getState()
  const cur = getFrame()
  if (!cur || !s.doc) return
  const img = await decodeImage(file.data)
  const pal = palette()
  const cache = new Map<number, number>()
  const px = new Uint8Array(img.width * img.height)
  for (let i = 0; i < px.length; i++) {
    const a = img.data[i * 4 + 3]
    px[i] = a < 128 ? 0 : nearestIndex(pal, img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], cache)
  }
  let f: Frame = { width: img.width, height: img.height, offsetX: cur.offsetX, offsetY: cur.offsetY, pixels: px }
  if (s.doc.kind === 'anim') f = trimFrame(f)
  commitFrame(s.dir, s.frame, cloneFrame(cur), f)
  toast(`Imported ${file.name} (${img.width}×${img.height}) into frame ${s.frame + 1}`)
}
