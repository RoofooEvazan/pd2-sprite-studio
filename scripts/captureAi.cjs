// Screenshots of the AI assistant (MCP) features for the docs, in a throwaway settings folder.
// Run: npm run build && npx electron scripts/captureAi.cjs
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'screenshots')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-capture-'))
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ exportRoot: path.join(ROOT, 'out-test', 'mcp-export'), mcp: { enabled: true, port: 41738 } }))
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
  win.setContentSize(1600, 940)
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()))
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; ${code} })()`)
  const shot = async (name, settle = 700) => {
    await wait(settle)
    fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log('captured', name)
  }
  try {
    await js(`localStorage.setItem('pd2ss.tipsSeen', '1'); for (let i = 0; i < 120 && !$('.big-card'); i++) await wait(250)`)
    await js(`$('[aria-label="Settings"]').click(); await wait(600); $$('.modal section').find((s) => s.innerText.includes('MCP')).scrollIntoView()`)
    await shot('16-ai-settings', 1000)

    // Tile Maker with an imported scene (plateau with cliffs: shows the lower-wall role)
    const plateau = JSON.stringify(path.join(ROOT, 'out-test', 'models', 'plateau.glb'))
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); $('.modal .x')?.click(); await wait(300)
      await window.__pd2Mcp('tiles_import_model', { path: ${plateau} })
      await window.__pd2Mcp('tiles_settings', { color_by_role: true })`)
    await shot('11-tile-maker', 2500)
    await js(`await window.__pd2Mcp('tiles_settings', { color_by_role: false }); await wait(300)
      $$('button').find((b) => b.innerText.includes('Split into DT1')).click(); for (let i = 0; i < 60 && !$('.tm-stats'); i++) await wait(250)`)
    await shot('12-tile-maker-result', 1500)
    await js(`$('.modal .x').click(); await wait(200); await window.__pd2Mcp('tiles_clear', {})`)

    // What an assistant builds through the Tile Maker tools
    await js(`const run = window.__pd2Mcp
      for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) await run('tiles_add_block', { shape: 'box', position: [x + 0.01, -0.06, z + 0.01], size: [0.98, 0.06, 0.98], color: (x + z) % 2 ? '#6e675c' : '#57524a', name: 'floor_' + x + '_' + z })
      await run('tiles_add_block', { shape: 'box', position: [0, 0, 0], size: [0.2, 2, 4], color: '#8f8573', name: 'wall_left' })
      await run('tiles_add_block', { shape: 'box', position: [0, 0, 0], size: [1.5, 2, 0.2], color: '#8f8573', name: 'wall_back_a' })
      await run('tiles_add_block', { shape: 'box', position: [2.5, 0, 0], size: [1.5, 2, 0.2], color: '#8f8573', name: 'wall_back_b' })
      await run('tiles_add_block', { shape: 'cylinder', position: [2.3, 0, 2.3], size: [0.4, 1.8, 0.4], color: '#b0a58f', name: 'pillar' })
      await run('tiles_add_block', { shape: 'box', position: [3.95, -1.2, 0], size: [0.1, 1.2, 4], color: '#5b5046', name: 'rock_east' })
      await run('tiles_add_block', { shape: 'box', position: [0, -1.2, 3.95], size: [4.05, 1.2, 0.1], color: '#4e453c', name: 'rock_south' })
      await run('tiles_settings', { name: 'aicourt', color_by_role: true })`)
    await shot('17-ai-tile-scene', 2000)
  } catch (e) {
    console.error('capture failed:', e)
  }
  app.quit()
})
