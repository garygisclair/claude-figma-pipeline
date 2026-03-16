#!/usr/bin/env node
/**
 * generate-identity-atoms.mjs
 * Generates SVG variants for Avatar, Badge, and Spinner atoms.
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'

function r2(n) { return Math.round(n * 100) / 100 }

// ─── Avatar ────────────────────────────────────────────────

function avatarSvg(type, size) {
  const dim = size === 'normal' ? 40 : 32
  const cx = dim / 2
  const cy = dim / 2
  const r = dim / 2

  let svg = `<svg width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  if (type === 'no-photo') {
    // Gray circle with profile icon silhouette
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#c7c7c7"/>`
    // Simplified profile icon (head + shoulders)
    const headR = dim * 0.15
    const bodyW = dim * 0.4
    const bodyH = dim * 0.2
    svg += `<circle cx="${cx}" cy="${cy - dim * 0.08}" r="${headR}" fill="white"/>`
    svg += `<rect x="${cx - bodyW / 2}" y="${cy + dim * 0.12}" width="${bodyW}" height="${bodyH}" rx="${bodyH / 2}" fill="white"/>`
  } else if (type === 'initials') {
    // Light blue circle with "AB" text
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#d4e5fe"/>`
    svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="#0968f6">AB</text>`
  } else if (type === 'photo') {
    // Gray circle with image placeholder (diagonal cross)
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f7f7f7"/>`
    svg += `<line x1="${dim * 0.3}" y1="${dim * 0.3}" x2="${dim * 0.7}" y2="${dim * 0.7}" stroke="#c7c7c7" stroke-width="1.5"/>`
    svg += `<line x1="${dim * 0.7}" y1="${dim * 0.3}" x2="${dim * 0.3}" y2="${dim * 0.7}" stroke="#c7c7c7" stroke-width="1.5"/>`
  }

  svg += '</svg>'
  return svg
}

const avatarTypes = ['no-photo', 'initials', 'photo']
const avatarSizes = ['normal', 'small']
const avatarVariants = []
for (const type of avatarTypes) {
  for (const size of avatarSizes) {
    const dim = size === 'normal' ? 40 : 32
    avatarVariants.push({
      name: `type=${type}, size=${size}`,
      width: dim,
      height: dim,
      svg: avatarSvg(type, size),
    })
  }
}

const avatarSpec = {
  name: 'Avatar',
  renderType: 'svg',
  variantProperties: { type: avatarTypes, size: avatarSizes },
  variants: avatarVariants,
}

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/Avatar.json'),
  JSON.stringify([avatarSpec], null, 2)
)
console.log(`Avatar: ${avatarVariants.length} variants`)

// ─── Badge ─────────────────────────────────────────────────

function badgeSvg(size) {
  const height = 24
  const border = 2
  const dims = { single: { w: 24, r: 12, label: '9' }, double: { w: 34, r: 12, label: '42' }, max: { w: 40, r: 12, label: '99+' } }
  const d = dims[size]

  let svg = `<svg width="${d.w}" height="${height}" viewBox="0 0 ${d.w} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Border (white ring)
  svg += `<rect x="0" y="0" width="${d.w}" height="${height}" rx="${d.r}" fill="white"/>`
  // Red background inset by border
  svg += `<rect x="${border}" y="${border}" width="${d.w - border * 2}" height="${height - border * 2}" rx="${d.r - border}" fill="#d50b0b"/>`
  // Label
  const cx = d.w / 2
  svg += `<text x="${cx}" y="16" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="white">${d.label}</text>`

  svg += '</svg>'
  return svg
}

const badgeSizes = ['single', 'double', 'max']
const badgeVariants = badgeSizes.map(size => {
  const dims = { single: 24, double: 34, max: 40 }
  return {
    name: `size=${size}`,
    width: dims[size],
    height: 24,
    svg: badgeSvg(size),
  }
})

const badgeSpec = {
  name: 'Badge',
  renderType: 'svg',
  variantProperties: { size: badgeSizes },
  variants: badgeVariants,
}

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/Badge.json'),
  JSON.stringify([badgeSpec], null, 2)
)
console.log(`Badge: ${badgeVariants.length} variants`)

// ─── Spinner ───────────────────────────────────────────────

function spinnerSvg(size) {
  const strokeWidth = size === 16 ? 1.5 : 2
  const r = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2

  // Annular arc for the track (full circle, light blue)
  const outerR = size / 2
  const innerR = outerR - strokeWidth

  function arcPath(startDeg, endDeg) {
    const toRad = (deg) => (deg - 90) * Math.PI / 180
    const s = toRad(startDeg)
    const e = toRad(endDeg)
    const large = (endDeg - startDeg) > 180 ? 1 : 0

    if (Math.abs(endDeg - startDeg) >= 360) {
      return `M${cx + outerR},${cy} A${outerR},${outerR} 0 1,1 ${cx - outerR},${cy} A${outerR},${outerR} 0 1,1 ${cx + outerR},${cy} ` +
             `M${cx + innerR},${cy} A${innerR},${innerR} 0 1,0 ${cx - innerR},${cy} A${innerR},${innerR} 0 1,0 ${cx + innerR},${cy} Z`
    }

    const ox1 = r2(cx + outerR * Math.cos(s)), oy1 = r2(cy + outerR * Math.sin(s))
    const ox2 = r2(cx + outerR * Math.cos(e)), oy2 = r2(cy + outerR * Math.sin(e))
    const ix1 = r2(cx + innerR * Math.cos(e)), iy1 = r2(cy + innerR * Math.sin(e))
    const ix2 = r2(cx + innerR * Math.cos(s)), iy2 = r2(cy + innerR * Math.sin(s))

    return `M${ox1},${oy1} A${outerR},${outerR} 0 ${large},1 ${ox2},${oy2} ` +
           `L${ix1},${iy1} A${innerR},${innerR} 0 ${large},0 ${ix2},${iy2} Z`
  }

  let svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Full track ring (light blue)
  svg += `<path d="${arcPath(0, 360)}" fill="#d4e5fe"/>`
  // Active arc (accent blue, 270° showing the "loading" state)
  svg += `<path d="${arcPath(0, 270)}" fill="#0968f6"/>`

  svg += '</svg>'
  return svg
}

const spinnerSizes = [16, 20, 24]
const spinnerVariants = spinnerSizes.map(size => ({
  name: `size=${size}`,
  width: size,
  height: size,
  svg: spinnerSvg(size),
}))

const spinnerSpec = {
  name: 'Spinner',
  renderType: 'svg',
  variantProperties: { size: spinnerSizes.map(String) },
  variants: spinnerVariants,
}

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/Spinner.json'),
  JSON.stringify([spinnerSpec], null, 2)
)
console.log(`Spinner: ${spinnerVariants.length} variants`)
