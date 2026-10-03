// Diagnose a unit that won't open: catalog entry, COFs, and every layer's DCC decode.
// Usage: npx tsx scripts/probeUnit.ts <search words>
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'
import { buildCatalog, cofPath, dccPath } from '../src/core/catalog'
import { COMPOSITS, decodeCof } from '../src/core/cof'
import { decodeDcc } from '../src/core/dcc'

const { vfs } = openGameVfs(defaultGameLocation())
const files: string[] = []
for (const a of vfs.archives) files.push(...a.listfile())
const cat = buildCatalog(files, (n) => vfs.read(`data\global\excel\${n}.txt`))
const q = process.argv.slice(2).join(' ').toLowerCase()
for (const u of cat.units.filter((u) => `${u.label} ${u.token}`.toLowerCase().includes(q))) {
  console.log(`\n${u.token} (${u.base}) "${u.label}" modes: ${JSON.stringify(u.modes)}`)
  for (const [mode, wcs] of Object.entries(u.modes))
    for (const wc of wcs) {
      const cp = cofPath(u, mode, wc)
      const data = vfs.read(cp)
      if (!data) {
        console.log(`  ${mode} ${wc}: COF missing ${cp}`)
        continue
      }
      try {
        const cof = decodeCof(data)
        const probs: string[] = []
        for (const l of cof.layers) {
          const comp = COMPOSITS[l.composit]
          const arm = (u.armtypes[comp] ?? []).filter((a) => u.dccs.includes(`${comp}${a}${mode}${l.weaponClass}`))
          if (!arm.length) {
            probs.push(`${comp}: no DCC for ${l.weaponClass} (armtypes ${u.armtypes[comp]?.join(',')})`)
            continue
          }
          const p = dccPath(u, comp, arm[0], mode, l.weaponClass)
          const d = vfs.read(p)
          if (!d) probs.push(`${comp}: unreadable ${p}`)
          else
            try {
              decodeDcc(d)
            } catch (e) {
              probs.push(`${comp}: decode failed ${p}: ${e instanceof Error ? e.message : e}`)
            }
        }
        console.log(`  ${mode} ${wc}: ${cof.layers.length} layers, ${cof.directions}x${cof.framesPerDir}${probs.length ? '\n    ' + probs.join('\n    ') : ' OK'}`)
      } catch (e) {
        console.log(`  ${mode} ${wc}: COF decode failed: ${e instanceof Error ? e.message : e}`)
      }
    }
}
