// Screenshots of the update check UI (header button, Settings › Updates, the dialog) in a throwaway settings folder.
// Run: npm run build && npx electron scripts/captureUpdate.cjs
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'out-test')
process.env.PD2SS_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-update-'))
const { app, BrowserWindow } = require('electron')
require(path.join(ROOT, 'out', 'main', 'index.js'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 50 && !win; i++) {
    await wait(200)
    win = BrowserWindow.getAllWindows()[0]
  }
  win.setContentSize(1400, 860)
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()))
  const js = (code) => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; ${code} })()`)
  const shot = async (name, settle = 800) => {
    await wait(settle)
    fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log('captured', name)
  }
  try {
    await js(`localStorage.setItem('pd2ss.tipsSeen', '1'); for (let i = 0; i < 120 && !$('.big-card'); i++) await wait(250)`)
    await js(`$('[aria-label="Check for updates"]').click()`)
    await shot('update-dialog', 3000)
    console.log('dialog text:', await js(`return $('.modal').innerText`))
    await js(`$('.modal .x').click(); await wait(200); $('[aria-label="Settings"]').click()`)
    await shot('update-settings', 1000)
  } catch (e) {
    console.error('capture failed:', e)
  }
  app.quit()
})
