import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'

await rm('dist-clipper', { recursive: true, force: true })
await mkdir('dist-clipper/icons', { recursive: true })

await Promise.all([
  cp('extension/icons', 'dist-clipper/icons', { recursive: true }),
  cp('clipper/manifest.json', 'dist-clipper/manifest.json'),
  cp('clipper/options.html', 'dist-clipper/options.html'),
  build({
    entryPoints: ['clipper/background.ts', 'clipper/options.ts'],
    outdir: 'dist-clipper',
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
  }),
])

console.log('右键插件已生成：dist-clipper/（在 chrome://extensions 加载此目录）')
