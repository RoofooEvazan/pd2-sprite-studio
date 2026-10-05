// Imports the example scene (GLB and OBJ) into the Tile Maker of the built app, splits it, and saves pictures.
// Run: npm run build && npx electron scripts/testDemoScene.cjs
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const DIR = path.join(ROOT, 'examples', 'tristram-courtyard')
const OUT = path.join(ROOT, 'out-test')
process.env.PD2SS_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-demo-'))
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
  const run = async (name, args = {}) => {
    console.log('  >', name)
    const r = await win.webContents.executeJavaScript(`window.__pd2Mcp(${JSON.stringify(name)}, ${JSON.stringify(args)})`)
    const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    const img = r.content.find((c) => c.type === 'image')
    if (r.isError) throw new Error(`${name}: ${text}`)
    return { text, img }
  }
  // capturePage can fail (UnknownVizError) while the window is covered or the GPU process restarts: show it and retry
  const shot = async (name) => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      await wait(1500)
      try {
        win.show()
        win.moveTop()
        fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG())
        return
      } catch (e) {
        if (attempt === 4) console.log(`  (screenshot ${name} skipped: ${e.message})`)
      }
    }
  }
  try {
    await win.webContents.executeJavaScript(`localStorage.setItem('pd2ss.tipsSeen', '1')`)
    for (let i = 0; i < 120; i++) {
      if (await win.webContents.executeJavaScript(`!!document.querySelector('.big-card')`)) break
      await wait(250)
    }
    for (const [label, file] of [
      ['GLB (Blender)', 'tristram_courtyard.glb'],
      ['OBJ (3ds Max)', 'tristram_courtyard.obj']
    ]) {
      await run('tiles_clear')
      const imp = await run('tiles_import_model', { path: path.join(DIR, file) })
      const roles = {}
      for (const m of imp.text.matchAll(/role=(\w+)/g)) roles[m[1]] = (roles[m[1]] ?? 0) + 1
      console.log(`\n${label}: ${imp.text.split('\n')[0]}`)
      console.log('  roles:', JSON.stringify(roles))
      console.log(imp.text.split('\n').filter((l) => /role=(lower|roof|floor)/.test(l)).join('\n'))
      await run('tiles_settings', { name: 'tristram', color_by_role: true })
      const tag = file.endsWith('.glb') ? 'glb' : 'obj'
      await shot(`demo_${tag}_roles`)
      await run('tiles_settings', { color_by_role: false })
      await shot(`demo_${tag}_textured`)
      const split = await run('tiles_split')
      console.log('  split:', split.text.split('. The picture')[0])
      if (split.img) fs.writeFileSync(path.join(OUT, `demo_${tag}_map.png`), Buffer.from(split.img.data, 'base64'))
    }
  } catch (e) {
    console.error('FAILED:', e && e.stack ? e.stack : e)
  }
  app.quit()
})
