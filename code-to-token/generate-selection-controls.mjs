#!/usr/bin/env node
/**
 * generate-selection-controls.mjs
 * Generates SVG strings for Radio, Checkbox, and Switch variants,
 * outputs a component spec JSON for the Figma plugin.
 *
 * Usage: node generate-selection-controls.mjs [output.json]
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'

const outputPath = resolve(process.argv[2] || 'components/SelectionControls.json')

// ─── Radio SVGs ────────────────────────────────────────────────

function radioSvg(size, selected, state) {
  const isSmall = size === 'small'
  const controlSize = isSmall ? 18 : 24
  const pad = isSmall ? 3 : 0
  const viewBox = 24
  const cx = viewBox / 2
  const cy = viewBox / 2
  const r = controlSize / 2 - 0.75 // minus half stroke
  const dotR = isSmall ? 3 : 4

  const isDisabled = state === 'disabled'
  const isFocused = state === 'focused'
  const isHover = state === 'hover'
  const isPressed = state === 'pressed'

  let borderColor = '#8f8f8f'  // --border-medium
  let fillColor = '#ffffff'    // --bg-primary
  let dotColor = '#ffffff'

  if (selected) {
    fillColor = '#191919'      // --fg-primary
    borderColor = '#191919'
  }
  if (isDisabled && !selected) {
    borderColor = '#c7c7c7'    // --border-disabled
  }
  if (isDisabled && selected) {
    fillColor = '#c7c7c7'      // --bg-disabled
    borderColor = '#c7c7c7'
  }

  let svg = `<svg width="${viewBox}" height="${viewBox}" viewBox="0 0 ${viewBox} ${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Hover/pressed ripple (36px circle)
  if ((isHover || isPressed) && !isDisabled) {
    const rippleOpacity = isPressed ? 0.08 : 0.04
    svg += `<circle cx="${cx}" cy="${cy}" r="18" fill="black" opacity="${rippleOpacity}"/>`
  }

  // Focus ring
  if (isFocused) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${controlSize / 2 + 2}" stroke="#0968f6" stroke-width="2" fill="rgba(0,0,0,0.04)"/>`
  }

  // Control circle
  svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${selected ? fillColor : '#ffffff'}" stroke="${borderColor}" stroke-width="1.5"/>`

  // Selected dot
  if (selected) {
    svg += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${dotColor}"/>`
  }

  svg += '</svg>'
  return svg
}

// ─── Checkbox SVGs ─────────────────────────────────────────────

function checkboxSvg(size, selected, indeterminate, state) {
  const isSmall = size === 'small'
  const controlSize = isSmall ? 18 : 24
  const viewBox = 24
  const cx = viewBox / 2
  const cy = viewBox / 2
  const half = controlSize / 2
  const x = cx - half
  const y = cy - half
  const cornerR = 3

  const isDisabled = state === 'disabled'
  const isFocused = state === 'focused'
  const isHover = state === 'hover'
  const isPressed = state === 'pressed'
  const isFilled = selected || indeterminate

  let borderColor = '#8f8f8f'
  let fillColor = '#ffffff'

  if (isFilled) {
    fillColor = '#191919'
    borderColor = '#191919'
  }
  if (isDisabled && !isFilled) {
    borderColor = '#c7c7c7'
  }
  if (isDisabled && isFilled) {
    fillColor = '#c7c7c7'
    borderColor = '#c7c7c7'
  }

  let svg = `<svg width="${viewBox}" height="${viewBox}" viewBox="0 0 ${viewBox} ${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Hover/pressed ripple
  if ((isHover || isPressed) && !isDisabled) {
    const rippleOpacity = isPressed ? 0.08 : 0.04
    svg += `<circle cx="${cx}" cy="${cy}" r="18" fill="black" opacity="${rippleOpacity}"/>`
  }

  // Focus ring
  if (isFocused) {
    svg += `<rect x="${x - 3}" y="${y - 3}" width="${controlSize + 6}" height="${controlSize + 6}" rx="4" stroke="#0968f6" stroke-width="2" fill="rgba(0,0,0,0.04)"/>`
  }

  // Control rect
  svg += `<rect x="${x + 0.75}" y="${y + 0.75}" width="${controlSize - 1.5}" height="${controlSize - 1.5}" rx="${cornerR}" fill="${isFilled ? fillColor : '#ffffff'}" stroke="${borderColor}" stroke-width="1.5"/>`

  // Checkmark
  if (selected && !indeterminate) {
    const checkW = isSmall ? 5 : 7
    const checkH = isSmall ? 9 : 12
    // Draw checkmark as two lines
    const startX = cx - checkW / 2
    const midX = cx - checkW / 2 + checkW * 0.35
    const midY = cy + checkH * 0.25
    const endX = cx + checkW / 2
    const startY = cy - checkH * 0.15
    const endY = cy - checkH * 0.35
    svg += `<path d="M${startX} ${cy} L${midX} ${midY} L${endX} ${endY}" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  }

  // Indeterminate dash
  if (indeterminate) {
    const dashW = isSmall ? 10 : 12
    svg += `<rect x="${cx - dashW / 2}" y="${cy - 1}" width="${dashW}" height="2" rx="1" fill="white"/>`
  }

  svg += '</svg>'
  return svg
}

// ─── Switch SVGs ───────────────────────────────────────────────

function switchSvg(selected, state) {
  const trackW = 40
  const trackH = 24
  const trackR = 12
  const handleSize = selected ? 16 : 12
  const handleX = selected ? 20 + handleSize / 2 : 6 + handleSize / 2
  const handleY = trackH / 2

  const isDisabled = state === 'disabled'
  const isFocused = state === 'focused'
  const isHover = state === 'hover'
  const isPressed = state === 'pressed'

  let trackColor = '#c7c7c7'
  let handleColor = '#ffffff'

  if (selected) trackColor = '#0968f6' // --bg-accent
  if (isDisabled) {
    trackColor = '#c7c7c7' // --bg-disabled
    handleColor = '#ffffff'
  }

  let svg = `<svg width="${trackW}" height="${trackH}" viewBox="0 0 ${trackW} ${trackH}" fill="none" xmlns="http://www.w3.org/2000/svg">`

  // Track
  svg += `<rect width="${trackW}" height="${trackH}" rx="${trackR}" fill="${trackColor}"/>`

  // Hover/pressed overlay on track
  if ((isHover || isPressed) && !isDisabled) {
    const rippleOpacity = isPressed ? 0.08 : 0.04
    svg += `<rect width="${trackW}" height="${trackH}" rx="${trackR}" fill="black" opacity="${rippleOpacity}"/>`
  }

  // Focus ring
  if (isFocused) {
    svg += `<rect x="-3" y="-3" width="${trackW + 6}" height="${trackH + 6}" rx="14" stroke="#0968f6" stroke-width="2" fill="rgba(0,0,0,0.04)"/>`
  }

  // Handle shadow + handle
  svg += `<circle cx="${handleX}" cy="${handleY}" r="${handleSize / 2 + 1}" fill="rgba(0,0,0,0.15)"/>`
  svg += `<circle cx="${handleX}" cy="${handleY}" r="${handleSize / 2}" fill="${handleColor}"/>`

  svg += '</svg>'
  return svg
}

// ─── Build specs ───────────────────────────────────────────────

const states = ['default', 'hover', 'pressed', 'disabled', 'focused']
const sizes = ['small', 'large']
const selections = [false, true]

// Radio
const radioVariants = []
for (const size of sizes) {
  for (const selected of selections) {
    for (const state of states) {
      radioVariants.push({
        name: `size=${size}, selected=${selected}, state=${state}`,
        width: 24,
        height: 24,
        svg: radioSvg(size, selected, state),
      })
    }
  }
}

// Checkbox
const checkboxVariants = []
const checkStates = ['unselected', 'selected', 'indeterminate']
for (const size of sizes) {
  for (const checkState of checkStates) {
    for (const state of states) {
      const selected = checkState === 'selected'
      const indeterminate = checkState === 'indeterminate'
      checkboxVariants.push({
        name: `size=${size}, checked=${checkState}, state=${state}`,
        width: 24,
        height: 24,
        svg: checkboxSvg(size, selected, indeterminate, state),
      })
    }
  }
}

// Switch
const switchVariants = []
for (const selected of selections) {
  for (const state of states) {
    switchVariants.push({
      name: `selected=${selected}, state=${state}`,
      width: 40,
      height: 24,
      svg: switchSvg(selected, state),
    })
  }
}

const output = [
  {
    name: 'Radio',
    renderType: 'svg',
    variantProperties: { size: sizes, selected: ['false', 'true'], state: states },
    variants: radioVariants,
  },
  {
    name: 'Checkbox',
    renderType: 'svg',
    variantProperties: { size: sizes, checked: checkStates, state: states },
    variants: checkboxVariants,
  },
  {
    name: 'Switch',
    renderType: 'svg',
    variantProperties: { selected: ['false', 'true'], state: states },
    variants: switchVariants,
  },
]

writeFileSync(outputPath, JSON.stringify(output, null, 2))

console.log('Generated selection controls:')
console.log(`  Radio: ${radioVariants.length} variants`)
console.log(`  Checkbox: ${checkboxVariants.length} variants`)
console.log(`  Switch: ${switchVariants.length} variants`)
console.log(`Output: ${outputPath}`)
