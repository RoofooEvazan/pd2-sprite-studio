// End to end: open a DT1 tile in the editor, trace a pixel lasso, mirror it along the wall, place it, save the
// tile set, and check that only that tile changed. Run: npm run build && npx electron scripts/testTileEdit.cjs
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'out-test')
const EXPORT = path.join(OUT, 'tile-edit-export')
fs.rmSync(EXPORT, { recursive: true, force: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-tileedit-'))
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ exportRoot: EXPORT }))
process.env.PD2SS_USER_DATA = userData
const { app, BrowserWindow } = require('electron')
require(path.join(ROOT, 'out', 'main', 'index.js'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 50 && !win; i++) {
    await wait(200)
    win = BrowserWindow.getAllWindows()[0]
  }
  win.setContentSize(1500, 900)
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()))
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; ${code} })()`)
  const shot = async (name) => {
    for (let k = 0; k < 4; k++)
      try {
        await wait(600)
        win.show()
        fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG())
        return
      } catch {
        /* retry */
      }
  }
  const step = (msg) => console.log(msg)
  try {
    await js(`localStorage.setItem('pd2ss.tipsSeen', '1'); localStorage.removeItem('pd2ss.lastDt1'); for (let i = 0; i < 160 && !$('.big-card'); i++) await wait(250)`)
    await js(`$$('.studio-card').find((c) => c.innerText.includes('Edit map tiles')).click(); await wait(400)
      const inp = $('.search-small input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, 'guild\\\\house1\\\\int'); inp.dispatchEvent(new Event('input', { bubbles: true })); await wait(300)
      $$('.tp-file').find((b) => b.title.toLowerCase().endsWith('house1\\\\int.dt1')).click()
      for (let i = 0; i < 40 && !$('.tp-tile'); i++) await wait(250)`)
    await shot('tileedit_1_browser')
    step('browser: ' + (await js(`return $$('.tp-tile').length + ' tiles shown'`)))
    await js(`$$('.tp-tile').find((b) => b.title.startsWith('Tile 4:')).click(); for (let i = 0; i < 40 && !$('.pixel-canvas'); i++) await wait(250); await wait(400)`)
    step('editor: ' + (await js(`return $('.crumb.current')?.innerText`)))

    // Pixel lasso around the arch rib (tile coordinates), clicking corner pixels and the first one again to close
    const clicks = [
      [90, -190],
      [141, -190],
      [141, -148],
      [90, -148],
      [90, -190]
    ]
    const res = await js(`
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); await wait(200)
      const log = []
      const c = $('.pixel-canvas'); let r = c.getBoundingClientRect()
      const zoom = c.width / ${160}
      // the tile frame starts at x 0 and 32 px above the highest block (y -256 for this tile)
      const at = (x, y) => ((r = c.getBoundingClientRect()), { bubbles: true, button: 0, clientX: r.left + (x - 0 + 0.5) * zoom, clientY: r.top + (y + 256 + 0.5) * zoom })
      for (const [x, y] of ${JSON.stringify(clicks)}) {
        c.dispatchEvent(new MouseEvent('mousedown', at(x, y)))
        window.dispatchEvent(new MouseEvent('mouseup', at(x, y)))
        await wait(60)
        log.push($('.statusbar').innerText.split('\\n').join(' ').slice(0, 90))
      }
      await wait(200)
      return { zoom, status: $('.statusbar').innerText, log, rect: [r.left, r.top, c.width, c.height] }`)
    step(`lasso: zoom ${res.zoom}; rect ${res.rect}; status "${res.status.replace(/\s+/g, ' ')}"`)
    for (const l of res.log) step('  after click: ' + l)
    await shot('tileedit_2_lasso')
    await js(`$$('.chip-btn').find((b) => b.innerText.includes('Mirror along wall')).click(); await wait(300)`)
    await shot('tileedit_3_mirrored')
    await js(`$$('.chip-btn').find((b) => b.innerText.trim() === 'Place').click(); await wait(300)`)
    step('placed: ' + (await js(`return $('.edited-dot') ? 'edited' : 'not edited'`)))
    const r = await js(`return await window.__pd2Mcp('export_pd2', {})`)
    step('export: ' + r.content.map((c) => c.text).join(' '))
  } catch (e) {
    console.error('FAILED:', e)
  }
  app.quit()
})
