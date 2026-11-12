import { cp, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
await mkdir('dist/icons', { recursive: true })
await cp('extension/icons', 'dist/icons', { recursive: true })
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'))
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n')
// dist is also the browser preview; dist-extension is the documented installation artifact.
// Remove obsolete generated files without touching any user database (stored by Chrome).
async function clearGeneratedFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) await clearGeneratedFiles(path)
    else await unlink(path)
  }
}
await clearGeneratedFiles('dist-extension')
await cp('dist', 'dist-extension', { recursive: true, force: true })
console.log('Chrome 扩展已生成：dist-extension/（在 chrome://extensions 加载此目录）')
