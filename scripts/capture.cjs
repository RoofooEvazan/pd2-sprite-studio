// Drives the built app through its main screens and saves screenshots to docs/screenshots/.
// Run: npm run build && npx electron scripts/capture.cjs
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'docs', 'screenshots')
require(path.join(ROOT, 'out', 'main', 'index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  let win
  for (let i = 0; i < 50 && !win; i++) {
    await wait(200)
    win = BrowserWindow.getAllWindows()[0]
  }
  win.setContentSize(1600, 940)
  win.center()
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()))
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const btn = (t) => $$('button').find((b) => b.innerText.trim().includes(t)); ${code} })()`)
  const shot = async (name, settle = 700) => {
    await wait(settle)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG())
    console.log('captured', name)
  }
  try {
    await js(`localStorage.setItem('pd2ss.tipsSeen', '1'); for (let i = 0; i < 120 && !$('.big-card'); i++) await wait(250)`)
    await shot('01-home', 1500)

    await js(`$$('.big-card')[0].click(); await wait(300)`)
    await shot('02-characters', 3500)

    await js(`$$('.unit-card').find((c) => c.innerText.includes('Barbarian')).click(); await wait(500); $$('.choice').find((c) => c.innerText.split('\\n')[0] === 'Attack').click()`)
    await shot('03-animation-chooser', 2500)

    await js(`$('.primary-btn.big').click(); for (let i = 0; i < 40 && !$('.editor'); i++) await wait(250)`)
    await shot('04-editor', 2500)

    // Paint a stroke on the torso so the transfer tool has something to carry
    await js(`
      const c = $('.pixel-canvas'); const r = c.getBoundingClientRect()
      const at = (fx, fy) => ({ bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, button: 0 })
      c.dispatchEvent(new MouseEvent('mousedown', at(0.46, 0.38)))
      for (let k = 1; k <= 10; k++) c.dispatchEvent(new MouseEvent('mousemove', at(0.46 + k * 0.012, 0.38)))
      window.dispatchEvent(new MouseEvent('mouseup', at(0.58, 0.38)))
      await wait(300)
      $$('.insp-tabs button').find((b) => b.innerText === 'Colours').click()`)
    await shot('05-editor-colours', 1200)

    await js(`btn('Copy the change to the other frames').click(); await wait(400); btn('Show me the result').click()`)
    await shot('06-transfer', 2500)

    await js(`$('.modal .x').click(); await wait(200); $$('.rail-btn').find((b) => b.innerText === 'More').click()`)
    await shot('07-more-menu', 600)

    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await wait(100); $('.topbar .ibtn').click(); await wait(400); $$('.big-card')[2].click()`)
    await shot('08-items', 3000)

    await js(`$('.back').click(); await wait(300); $$('.big-card')[1].click()`)
    await shot('09-monsters', 4500)

    // 3D Studio, back from the editor so it renders into the Barbarian's torso
    process.env.PD2SS_OPEN3D = path.join(ROOT, 'out-test', 'models', 'knight.glb')
    await js(`$('.back').click(); await wait(300); btn('Continue editing').click(); await wait(800); $$('.rail-btn').find((b) => b.innerText === 'More').click(); await wait(200); $$('.menu-item').find((b) => b.innerText.startsWith('Open the 3D Studio')).click(); await wait(800);
      btn('Load model').click(); for (let i = 0; i < 40 && !$('.st-obj'); i++) await wait(250); await wait(500)
      btn('Add shape').click(); await wait(200); $$('.menu-item').find((b) => b.innerText.startsWith('Cylinder')).click(); await wait(300)
      const sel = $$('.st-left select')[0]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'RightHand'); sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(200)
      const col = $('.st-left input[type=color]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(col, '#d8dbe3'); col.dispatchEvent(new Event('input', { bubbles: true }))
      $$('.st-view-bar button').find((b) => b.innerText === 'Free look').click()`)
    await shot('10-3d-studio', 2500)

    // Tile Maker with the chapel scene
    process.env.PD2SS_OPEN3D = path.join(ROOT, 'out-test', 'models', 'chapel.glb')
    await js(`$('.topbar .ibtn').click(); await wait(400); $$('.studio-card').find((c) => c.innerText.includes('Tile Maker')).click(); await wait(800);
      btn('Import from Blender').click(); for (let i = 0; i < 40 && !$('.tm-part'); i++) await wait(250)`)
    await shot('11-tile-maker', 2500)

    await js(`btn('Split into DT1').click(); for (let i = 0; i < 60 && !$('.tm-stats'); i++) await wait(250)`)
    await shot('12-tile-maker-result', 1500)
  } catch (e) {
    console.error('capture failed:', e)
  }
  app.quit()
})
