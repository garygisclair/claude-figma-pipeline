#!/usr/bin/env node
/**
 * generate-chip.mjs
 * Generates SVG variants for the Chip atom.
 * 6 variants: State (default, hover, close-hover) × Type (avatar, default)
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'

function r2(n) { return Math.round(n * 100) / 100 }

function chipSvg(type, state) {
  const h = 32
  const avatarSize = 32
  const closeSize = 24
  const labelText = 'Text Label'
  const fontSize = 12
  const charWidth = 6.5 // approximate
  const labelWidth = Math.ceil(labelText.length * charWidth)
  const gap = 8
  const padRight = 4

  const isAvatar = type === 'avatar'
  const isHover = state === 'hover'
  const isCloseHover = state === 'close-hover'

  // Calculate total width
  let contentWidth = 0
  if (isAvatar) {
    contentWidth = avatarSize + gap + labelWidth + gap
  } else {
    contentWidth = 12 + labelWidth + gap // 12px left pad + label + gap
  }
  const totalWidth = contentWidth + closeSize + padRight
  const r = h / 2

  let svg = `<svg width="${totalWidth}" height="${h}" viewBox="0 0 ${totalWidth} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Background pill
  svg += `<rect width="${totalWidth}" height="${h}" rx="${r}" fill="#EEEEEE"/>`

  // Chip-level hover overlay
  if (isHover) {
    svg += `<rect width="${totalWidth}" height="${h}" rx="${r}" fill="black" opacity="0.04"/>`
  }

  let x = 0

  // Avatar or left padding
  if (isAvatar) {
    // Avatar circle (gray, no-photo style)
    svg += `<circle cx="${avatarSize / 2}" cy="${h / 2}" r="${avatarSize / 2}" fill="#c7c7c7"/>`
    // Simple profile silhouette
    svg += `<circle cx="${avatarSize / 2}" cy="${h / 2 - 2}" r="5" fill="white"/>`
    svg += `<rect x="${avatarSize / 2 - 7}" y="${h / 2 + 5}" width="14" height="6" rx="3" fill="white"/>`
    x = avatarSize + gap
  } else {
    x = 12
  }

  // Label text
  svg += `<text x="${x}" y="${h / 2 + fontSize / 3}" font-family="sans-serif" font-size="${fontSize}" font-weight="400" fill="#191919">${labelText}</text>`
  x += labelWidth + gap

  // Close button area
  const closeCx = x + closeSize / 2
  const closeCy = h / 2

  // Close button hover state
  if (isCloseHover) {
    svg += `<circle cx="${closeCx}" cy="${closeCy}" r="${closeSize / 2}" fill="black" opacity="0.04"/>`
  }

  // Close X icon (two lines)
  const xSize = 4
  svg += `<line x1="${closeCx - xSize}" y1="${closeCy - xSize}" x2="${closeCx + xSize}" y2="${closeCy + xSize}" stroke="#191919" stroke-width="1.5" stroke-linecap="round"/>`
  svg += `<line x1="${closeCx + xSize}" y1="${closeCy - xSize}" x2="${closeCx - xSize}" y2="${closeCy + xSize}" stroke="#191919" stroke-width="1.5" stroke-linecap="round"/>`

  svg += '</svg>'
  return { svg, width: totalWidth }
}

const types = ['avatar', 'default']
const states = ['default', 'hover', 'close-hover']
const variants = []

for (const type of types) {
  for (const state of states) {
    const result = chipSvg(type, state)
    variants.push({
      name: `state=${state}, type=${type}`,
      width: Math.ceil(result.width),
      height: 32,
      svg: result.svg,
    })
  }
}

const spec = [{
  name: 'Chip',
  renderType: 'svg',
  variantProperties: {
    type: types,
    state: states,
  },
  variants,
}]

writeFileSync(
  resolve(import.meta.dirname || '.', 'components/Chip.json'),
  JSON.stringify(spec, null, 2)
)

console.log(`Chip: ${variants.length} variants`)
