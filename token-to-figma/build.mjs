import { build } from 'esbuild'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'

const watch = process.argv.includes('--watch')

// Build the plugin code (TS → JS, targeting ES2015 for Figma sandbox)
await build({
  entryPoints: ['src/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  target: 'es2015',
  format: 'iife',
  logLevel: 'info',
  ...(watch && {
    plugins: [{
      name: 'rebuild-notify',
      setup(build) {
        build.onEnd(result => {
          console.log(`[${new Date().toLocaleTimeString()}] rebuild: ${result.errors.length} errors`)
        })
      }
    }]
  })
})

// Copy UI HTML to dist
mkdirSync('dist', { recursive: true })
const html = readFileSync('src/ui.html', 'utf-8')
writeFileSync('dist/ui.html', html)

console.log('Build complete: dist/code.js + dist/ui.html')
