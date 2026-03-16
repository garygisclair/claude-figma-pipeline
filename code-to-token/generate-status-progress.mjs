#!/usr/bin/env node
/**
 * generate-status-progress.mjs
 * Generates SVG variants for Status and ProgressDonut atoms.
 * Outputs component spec JSONs.
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'

// ─── Status ────────────────────────────────────────────────

const statusVariants = [
  { name: 'status=pending',   color: '#f7b100' },
  { name: 'status=canceled',  color: '#767676' },
  { name: 'status=draft',     color: '#c7c7c7' },
  { name: 'status=rejected',  color: '#e62048' },
  { name: 'status=submitted', color: '#28a443' },
]

const statusSpec = {
  name: 'Status',
  renderType: 'svg',
  variantProperties: {
    status: ['pending', 'canceled', 'draft', 'rejected', 'submitted'],
  },
  variants: statusVariants.map(v => ({
    name: v.name,
    width: 12,
    height: 12,
    svg: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="6" fill="${v.color}"/></svg>`,
  })),
}

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/Status.json'),
  JSON.stringify([statusSpec], null, 2)
)
console.log(`Status: ${statusSpec.variants.length} variants`)

// ─── Progress Donut ────────────────────────────────────────

const progressValues = [0, 25, 50, 75, 100]
const donutSize = 24
const strokeWidth = 3
const r = (donutSize - strokeWidth) / 2
const circumference = 2 * Math.PI * r
const center = donutSize / 2

/** Build an annular arc path (filled donut segment) */
function arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
  const toRad = (deg) => (deg - 90) * Math.PI / 180 // -90 to start at 12 o'clock
  const cos = Math.cos, sin = Math.sin

  if (Math.abs(endAngle - startAngle) >= 360) {
    // Full circle — two semicircles to avoid zero-length arc
    return `M${cx + outerR},${cy} A${outerR},${outerR} 0 1,1 ${cx - outerR},${cy} A${outerR},${outerR} 0 1,1 ${cx + outerR},${cy} ` +
           `M${cx + innerR},${cy} A${innerR},${innerR} 0 1,0 ${cx - innerR},${cy} A${innerR},${innerR} 0 1,0 ${cx + innerR},${cy} Z`
  }

  const s = toRad(startAngle)
  const e = toRad(endAngle)
  const largeArc = (endAngle - startAngle) > 180 ? 1 : 0

  const ox1 = cx + outerR * cos(s), oy1 = cy + outerR * sin(s)
  const ox2 = cx + outerR * cos(e), oy2 = cy + outerR * sin(e)
  const ix1 = cx + innerR * cos(e), iy1 = cy + innerR * sin(e)
  const ix2 = cx + innerR * cos(s), iy2 = cy + innerR * sin(s)

  return `M${r2(ox1)},${r2(oy1)} A${outerR},${outerR} 0 ${largeArc},1 ${r2(ox2)},${r2(oy2)} ` +
         `L${r2(ix1)},${r2(iy1)} A${innerR},${innerR} 0 ${largeArc},0 ${r2(ix2)},${r2(iy2)} Z`
}

function r2(n) { return Math.round(n * 100) / 100 }

function progressDonutSvg(pct) {
  const outerR = donutSize / 2
  const innerR = outerR - strokeWidth

  let svg = `<svg width="${donutSize}" height="${donutSize}" viewBox="0 0 ${donutSize} ${donutSize}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Track (full circle)
  svg += `<path d="${arcPath(center, center, outerR, innerR, 0, 360)}" fill="#c7c7c7"/>`

  // Progress arc
  if (pct > 0) {
    const angle = (pct / 100) * 360
    svg += `<path d="${arcPath(center, center, outerR, innerR, 0, angle)}" fill="#119c4b"/>`
  }

  svg += '</svg>'
  return svg
}

const progressSpec = {
  name: 'Progress Donut',
  renderType: 'svg',
  variantProperties: {
    progress: progressValues.map(String),
  },
  variants: progressValues.map(pct => ({
    name: `progress=${pct}`,
    width: donutSize,
    height: donutSize,
    svg: progressDonutSvg(pct),
  })),
}

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/ProgressDonut.json'),
  JSON.stringify([progressSpec], null, 2)
)
console.log(`Progress Donut: ${progressSpec.variants.length} variants`)
