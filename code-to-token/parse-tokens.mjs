#!/usr/bin/env node
/**
 * parse-tokens.mjs
 * Parses a CSS custom properties file + optional Figma exports
 * into a Figma-ready JSON structure.
 *
 * Usage:
 *   node parse-tokens.mjs <tokens.css> <output.json> \
 *     [--dimensions <figma-dimension-export.json>] \
 *     [--colors-light <figma-light.tokens.json>] \
 *     [--colors-dark <figma-dark.tokens.json>]
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// Parse args
const args = process.argv.slice(2)
let inputPath, outputPath, dimensionsPath, colorsLightPath, colorsDarkPath

function extractArg(flag) {
  const idx = args.indexOf(flag)
  if (idx === -1) return undefined
  const val = resolve(args[idx + 1])
  args.splice(idx, 2)
  return val
}

dimensionsPath = extractArg('--dimensions')
colorsLightPath = extractArg('--colors-light')
colorsDarkPath = extractArg('--colors-dark')

inputPath = resolve(args[0] || 'tokens.css')
outputPath = resolve(args[1] || 'tokens.json')

const css = readFileSync(inputPath, 'utf-8')

/** Extract all --name: value pairs from a CSS block string */
function extractVars(block) {
  const vars = {}
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g
  let m
  while ((m = re.exec(block)) !== null) {
    vars[m[1]] = m[2].trim()
  }
  return vars
}

/** Find the content between the braces of a given selector */
function extractBlock(css, selector) {
  const idx = css.indexOf(selector)
  if (idx === -1) return ''
  const start = css.indexOf('{', idx)
  if (start === -1) return ''
  let depth = 1
  let i = start + 1
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++
    if (css[i] === '}') depth--
    i++
  }
  return css.slice(start + 1, i - 1)
}

const lightBlock = extractBlock(css, ':root')
const darkBlock = extractBlock(css, '[data-dark="true"]')
const lightVars = extractVars(lightBlock)
const darkVars = extractVars(darkBlock)

function round(n) {
  return Math.round(n * 10000) / 10000
}

/** Parse hex to {r,g,b,a} with 0-1 range */
function hexToRgba(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
  if (hex.length === 6) hex += 'ff'
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  const a = parseInt(hex.slice(6, 8), 16) / 255
  return { r: round(r), g: round(g), b: round(b), a: round(a) }
}

/** Convert Figma sRGB components [r,g,b] + alpha to our {r,g,b,a} format */
function figmaColorToRgba(val) {
  return {
    r: round(val.components[0]),
    g: round(val.components[1]),
    b: round(val.components[2]),
    a: round(val.alpha != null ? val.alpha : 1),
  }
}

function parseNumeric(value) {
  const match = value.match(/^(-?[\d.]+)\s*(px|em|rem|%)?$/)
  if (!match) return null
  return { value: parseFloat(match[1]), unit: match[2] || '' }
}

function getCollection(name) {
  if (name.startsWith('bg-') || name.startsWith('fg-') || name.startsWith('border-') ||
      name.startsWith('state-') || name.startsWith('scrim-') || name.startsWith('logo-')) return 'Colors'
  if (name.startsWith('shadow-')) return 'Elevation'
  if (name.startsWith('radius-') || name.startsWith('spacing-')) return 'Dimensions'
  if (name.startsWith('type-') || name.startsWith('font-')) return 'Typography'
  return 'Other'
}

function getTokenName(name) {
  const dash = name.indexOf('-')
  if (dash === -1) return name
  const prefix = name.slice(0, dash)
  const rest = name.slice(dash + 1)
  if (['bg', 'fg', 'border', 'state', 'scrim', 'shadow', 'radius', 'spacing', 'type', 'font', 'logo'].includes(prefix)) {
    return prefix + '/' + rest
  }
  return name
}

function getFigmaType(name, value) {
  if (value.startsWith('#')) return 'COLOR'
  if (name.startsWith('font-family')) return 'STRING'
  if (parseNumeric(value)) return 'FLOAT'
  if (value.match(/^-?[\d.]+em$/)) return 'FLOAT'
  return null
}

// ─── Build collections from CSS ───────────────────────────────────────

const collections = {}
const useFigmaColors = colorsLightPath && colorsDarkPath

for (const [name, value] of Object.entries(lightVars)) {
  const collection = getCollection(name)
  const figmaType = getFigmaType(name, value)

  if (collection === 'Elevation') continue
  if (collection === 'Dimensions' && dimensionsPath) continue
  if (collection === 'Colors' && useFigmaColors) continue
  if (!figmaType) continue

  if (!collections[collection]) collections[collection] = {}

  const tokenName = getTokenName(name)
  const darkValue = darkVars[name]

  if (figmaType === 'COLOR') {
    const lightColor = hexToRgba(value)
    const darkColor = darkValue && darkValue.startsWith('#') ? hexToRgba(darkValue) : null
    collections[collection][tokenName] = {
      type: 'COLOR',
      light: lightColor,
      ...(darkColor && { dark: darkColor }),
      _lightRaw: value,
      ...(darkValue && { _darkRaw: darkValue }),
    }
  } else if (figmaType === 'FLOAT') {
    let num
    if (value.endsWith('em')) {
      num = parseFloat(value)
    } else {
      const parsed = parseNumeric(value)
      num = parsed ? parsed.value : parseFloat(value)
    }
    if (isNaN(num)) continue

    collections[collection][tokenName] = {
      type: 'FLOAT',
      light: num,
      _lightRaw: value,
    }
  } else if (figmaType === 'STRING') {
    const cleaned = value.replace(/^["']|["']$/g, '').split(',')[0].trim().replace(/^["']|["']$/g, '')
    collections[collection][tokenName] = {
      type: 'STRING',
      light: cleaned,
      _lightRaw: value,
    }
  }
}

// ─── Merge Figma color exports (authoritative source) ─────────────────

if (useFigmaColors) {
  const lightData = JSON.parse(readFileSync(colorsLightPath, 'utf-8'))
  const darkData = JSON.parse(readFileSync(colorsDarkPath, 'utf-8'))
  const colorTokens = {}

  for (const [group, tokens] of Object.entries(lightData)) {
    if (group === '$extensions') continue

    for (const [tokenName, def] of Object.entries(tokens)) {
      // Handle nested sub-groups (e.g. Background/Status/Attention-subtle)
      if (def.$type === 'color') {
        const displayName = group + '/' + tokenName
        const lightColor = figmaColorToRgba(def.$value)

        // Find matching dark token
        const darkDef = darkData[group] && darkData[group][tokenName]
        const darkColor = darkDef && darkDef.$type === 'color'
          ? figmaColorToRgba(darkDef.$value)
          : null

        const entry = {
          type: 'COLOR',
          light: lightColor,
          ...(darkColor && { dark: darkColor }),
          _lightRaw: def.$value.hex,
          ...(darkDef && { _darkRaw: darkDef.$value.hex }),
        }

        // Preserve Figma scoping
        const scopes = def.$extensions && def.$extensions['com.figma.scopes']
        if (scopes) entry.scopes = scopes

        colorTokens[displayName] = entry
      } else {
        // Nested group (e.g. Status contains sub-tokens)
        for (const [subName, subDef] of Object.entries(def)) {
          if (typeof subDef !== 'object' || !subDef.$type) continue
          if (subDef.$type !== 'color') continue

          const displayName = group + '/' + tokenName + '/' + subName
          const lightColor = figmaColorToRgba(subDef.$value)

          const darkGroup = darkData[group] && darkData[group][tokenName]
          const darkSubDef = darkGroup && darkGroup[subName]
          const darkColor = darkSubDef && darkSubDef.$type === 'color'
            ? figmaColorToRgba(darkSubDef.$value)
            : null

          const entry = {
            type: 'COLOR',
            light: lightColor,
            ...(darkColor && { dark: darkColor }),
            _lightRaw: subDef.$value.hex,
            ...(darkSubDef && { _darkRaw: darkSubDef.$value.hex }),
          }

          const scopes = subDef.$extensions && subDef.$extensions['com.figma.scopes']
          if (scopes) entry.scopes = scopes

          colorTokens[displayName] = entry
        }
      }
    }
  }

  collections['Colors'] = colorTokens
  console.log(`Loaded ${Object.keys(colorTokens).length} color tokens from Figma export`)
}

// ─── Merge Figma dimension export (authoritative source) ──────────────

if (dimensionsPath) {
  const figmaDims = JSON.parse(readFileSync(dimensionsPath, 'utf-8'))
  const dimTokens = {}

  for (const [group, tokens] of Object.entries(figmaDims)) {
    if (group === '$extensions') continue

    for (const [tokenName, def] of Object.entries(tokens)) {
      const displayName = group + '/' + tokenName

      const entry = {
        type: 'FLOAT',
        light: def.$value,
        _lightRaw: def.$value + 'px',
      }

      const scopes = def.$extensions && def.$extensions['com.figma.scopes']
      if (scopes) entry.scopes = scopes

      dimTokens[displayName] = entry
    }
  }

  collections['Dimensions'] = dimTokens
  console.log(`Loaded ${Object.keys(dimTokens).length} dimension tokens from Figma export`)
}

// ─── Extract shadow effect styles from CSS ────────────────────────────

const effectStyles = {}

/** Parse a CSS box-shadow value into structured layers */
function parseShadow(cssValue) {
  // Split on comma, but only top-level (not inside rgba())
  const layers = []
  let depth = 0, current = ''
  for (let i = 0; i < cssValue.length; i++) {
    const ch = cssValue[i]
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      layers.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) layers.push(current.trim())

  return layers.map(layer => {
    // Parse: Xpx Ypx Blur [Spread] color
    const rgbaMatch = layer.match(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/)
    const hexMatch = layer.match(/#([0-9a-fA-F]{6,8})/)
    let color
    if (rgbaMatch) {
      color = {
        r: round(parseFloat(rgbaMatch[1]) / 255),
        g: round(parseFloat(rgbaMatch[2]) / 255),
        b: round(parseFloat(rgbaMatch[3]) / 255),
        a: round(parseFloat(rgbaMatch[4])),
      }
    } else if (hexMatch) {
      color = hexToRgba('#' + hexMatch[1])
    } else {
      return null
    }

    // Extract numeric values before the color
    const numPart = layer.replace(/rgba\([^)]+\)/, '').replace(/#[0-9a-fA-F]+/, '').trim()
    const nums = numPart.match(/-?[\d.]+/g) || []
    const x = parseFloat(nums[0] || '0')
    const y = parseFloat(nums[1] || '0')
    const blur = parseFloat(nums[2] || '0')
    const spread = parseFloat(nums[3] || '0')

    return { x, y, blur, spread, color }
  }).filter(Boolean)
}

// Extract shadows from :root CSS vars
for (const [name, value] of Object.entries(lightVars)) {
  if (!name.startsWith('shadow-')) continue
  const layers = parseShadow(value)
  if (layers.length === 0) continue

  const styleName = 'Shadow/' + name.replace('shadow-', '').replace(/^\w/, c => c.toUpperCase())
  effectStyles[styleName] = { type: 'EFFECT', layers }
}

if (Object.keys(effectStyles).length > 0) {
  console.log(`Extracted ${Object.keys(effectStyles).length} effect styles from CSS`)
}

// ─── Extract text styles from CSS typography tokens ───────────────────

const textStyles = {}

// Group typography tokens by style name: type-display-1-size → display-1
const typeTokensByStyle = {}
for (const [name, value] of Object.entries(lightVars)) {
  if (!name.startsWith('type-')) continue
  // type-display-1-size → parts: ['display', '1', 'size']
  const withoutPrefix = name.slice(5) // remove 'type-'
  // Find the property suffix (size, weight, line-height, tracking)
  let styleName, prop
  if (withoutPrefix.endsWith('-size')) {
    styleName = withoutPrefix.slice(0, -5)
    prop = 'size'
  } else if (withoutPrefix.endsWith('-weight')) {
    styleName = withoutPrefix.slice(0, -7)
    prop = 'weight'
  } else if (withoutPrefix.endsWith('-line-height')) {
    styleName = withoutPrefix.slice(0, -12)
    prop = 'lineHeight'
  } else if (withoutPrefix.endsWith('-tracking')) {
    styleName = withoutPrefix.slice(0, -9)
    prop = 'tracking'
  } else {
    continue
  }
  if (!typeTokensByStyle[styleName]) typeTokensByStyle[styleName] = {}
  typeTokensByStyle[styleName][prop] = value
}

// Convert each grouped style to a text style entry
const fontFamily = lightVars['font-family-primary']
  ? lightVars['font-family-primary'].replace(/^["']|["']$/g, '').split(',')[0].trim().replace(/^["']|["']$/g, '')
  : 'Inter'

for (const [styleName, props] of Object.entries(typeTokensByStyle)) {
  if (!props.size) continue

  const size = parseFloat(props.size)
  const weight = props.weight ? parseInt(props.weight) : 400
  const lineHeight = props.lineHeight ? parseFloat(props.lineHeight) : 0
  const fontStyle = weight >= 700 ? 'Bold' : 'Regular'

  // Convert tracking: em → percent for Figma (0.05em = 5%)
  let letterSpacing = 0
  let letterSpacingUnit = 'PERCENT'
  if (props.tracking) {
    if (props.tracking.endsWith('em')) {
      letterSpacing = parseFloat(props.tracking) * 100 // 0.05em → 5, -0.02em → -2
    } else {
      letterSpacing = parseFloat(props.tracking)
      letterSpacingUnit = 'PIXELS'
    }
  }

  // Build display name: display-1 → Display 1, body-bold → Body Bold
  const displayName = styleName
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  const entry = {
    type: 'TEXT',
    fontFamily,
    fontStyle,
    fontSize: size,
    fontWeight: weight,
    lineHeight,
    letterSpacing,
    letterSpacingUnit,
  }

  // Signal styles are uppercase
  if (styleName.startsWith('signal')) {
    entry.textCase = 'UPPER'
  }

  // Link styles have underline
  if (styleName.startsWith('link')) {
    entry.textDecoration = 'UNDERLINE'
  }

  textStyles[displayName] = entry
}

if (Object.keys(textStyles).length > 0) {
  console.log(`Extracted ${Object.keys(textStyles).length} text styles from CSS`)
}

// ─── Output ───────────────────────────────────────────────────────────

const sources = { css: inputPath }
if (dimensionsPath) sources.dimensions = dimensionsPath
if (colorsLightPath) sources.colorsLight = colorsLightPath
if (colorsDarkPath) sources.colorsDark = colorsDarkPath

const output = {
  sources,
  generated: new Date().toISOString(),
  collections,
  ...(Object.keys(effectStyles).length > 0 && { effectStyles }),
  ...(Object.keys(textStyles).length > 0 && { textStyles }),
}

// ─── Load component specs if present ──────────────────────────────────

const componentDir = resolve(import.meta.dirname || '.', 'components')
try {
  const { readdirSync } = await import('fs')
  const files = readdirSync(componentDir).filter(f => f.endsWith('.json'))
  if (files.length > 0) {
    output.components = []
    for (const file of files) {
      const spec = JSON.parse(readFileSync(resolve(componentDir, file), 'utf-8'))
      output.components.push(spec)
      console.log(`Loaded component spec: ${spec.name}`)
    }
  }
} catch (e) {
  // No components directory, skip
}

writeFileSync(outputPath, JSON.stringify(output, null, 2))

let totalTokens = 0
const summary = {}
for (const [colName, tokens] of Object.entries(output.collections)) {
  const count = Object.keys(tokens).length
  totalTokens += count
  const types = {}
  for (const t of Object.values(tokens)) {
    types[t.type] = (types[t.type] || 0) + 1
  }
  summary[colName] = { count, types }
}

console.log(`Parsed ${totalTokens} tokens across ${Object.keys(output.collections).length} collections:`)
for (const [name, info] of Object.entries(summary)) {
  const typeStr = Object.entries(info.types).map(([t, n]) => `${n} ${t}`).join(', ')
  console.log(`  ${name}: ${info.count} tokens (${typeStr})`)
}
console.log(`Output: ${outputPath}`)
