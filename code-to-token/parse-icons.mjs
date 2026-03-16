#!/usr/bin/env node
/**
 * parse-icons.mjs
 * Reads SVG icon files from a directory and outputs a categorized JSON file
 * that the Figma plugin can use to create icon components with section layout.
 *
 * Usage: node parse-icons.mjs <icons-directory> <output.json>
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { resolve, basename } from 'path'

const inputDir = resolve(process.argv[2] || 'icons')
const outputPath = resolve(process.argv[3] || 'icons.json')

// Categories matching the ITSS Pipeline V2 library page
const ICON_CATEGORIES = [
  {
    title: 'Navigation',
    icons: [
      'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right',
      'chevron-up', 'chevron-down', 'chevron-left', 'chevron-right',
      'categories', 'close', 'external-link', 'home',
      'menu', 'notification', 'overflow-vertical', 'overflow-horizontal',
      'search', 'settings',
    ],
  },
  {
    title: 'Actions',
    icons: [
      'add', 'attach', 'bookmark', 'bookmark-fill',
      'clear', 'compose', 'copy', 'delete', 'duplicate',
      'drag-drop', 'download', 'edit', 'filter',
      'hide', 'like', 'like-filled', 'link',
      'lock', 'lock-fill', 'mail', 'maximize', 'minimize',
      'mute', 'pause', 'pin', 'pin-fill', 'play',
      'remove', 'refresh', 'return', 'send', 'share',
      'show', 'show-fill', 'sort', 'sort-down', 'sort-up',
      'star', 'star-filled', 'sync',
      'thumb-up', 'thumb-up-fill', 'thumb-down', 'thumb-down-fill',
      'tick', 'responsive', 'unlock', 'upload',
    ],
  },
  {
    title: 'Objects',
    icons: [
      'ai', 'ai-fill', 'book', 'book-closed', 'box',
      'building', 'briefcase', 'calendar', 'chat',
      'chat-bubble', 'clipboard', 'clock', 'code',
      'code-block', 'codepen', 'code-sandbox', 'comment',
      'coffee', 'dashboard', 'database', 'dollar',
      'feather', 'file', 'flag', 'folder', 'graph',
      'gift', 'globe', 'hand-heart', 'handshake-heart',
      'hash', 'headphones', 'image', 'list-view',
      'location', 'masonry-view', 'mic', 'page',
      'phone', 'qr-code', 'org-chart', 'prompt',
      'profile', 'smile-face', 'video', 'rocket',
      'world', 'web-search',
    ],
  },
  {
    title: 'Status',
    icons: [
      'attention', 'attention-filled', 'attention-fill',
      'confirmation', 'confirmation-fill',
      'help', 'information', 'information-fill',
      'negative', 'negative-fill',
      'progress-current', 'progress-upcoming',
      'warning', 'warning-fill',
    ],
  },
  {
    title: 'Social',
    icons: ['facebook', 'twitter', 'linkedin', 'instagram', 'slack'],
  },
  {
    title: 'Specific',
    icons: ['robot', 'robot-fill', 'profile-code', 'chatgpt'],
  },
  {
    title: 'Hub',
    icons: [
      'hub-truck', 'hub-arrow-right-circle', 'hub-org-sites',
      'hub-handshake', 'hub-briefcase', 'hub-legal',
      'hub-workplace', 'hub-bookspace', 'hub-yjmmd', 'hub-draggable',
    ],
  },
]

const ALL_SIZES = [10, 12, 16, 20, 24]

const files = readdirSync(inputDir).filter(f => f.endsWith('.svg'))

// Build a lookup: baseName → { size → svgContent }
const iconMap = {}
for (const file of files) {
  const fullName = basename(file, '.svg')
  const svg = readFileSync(resolve(inputDir, file), 'utf-8')

  if (fullName.endsWith('-scalable')) {
    const baseName = fullName.replace(/-scalable$/, '')
    if (!iconMap[baseName]) iconMap[baseName] = {}
    iconMap[baseName][48] = svg
  } else {
    const sizeMatch = fullName.match(/-(\d+)$/)
    if (sizeMatch) {
      const baseName = fullName.replace(/-\d+$/, '')
      const size = parseInt(sizeMatch[1])
      if (!iconMap[baseName]) iconMap[baseName] = {}
      iconMap[baseName][size] = svg
    }
  }
}

// Build categorized output
const categories = []
const categorized = new Set()

for (const cat of ICON_CATEGORIES) {
  const entries = []

  for (const baseName of cat.icons) {
    if (!iconMap[baseName]) continue
    categorized.add(baseName)

    const sizes = Object.keys(iconMap[baseName]).map(Number).sort((a, b) => a - b)
    for (const size of sizes) {
      const name = size === 48 ? `${baseName}-scalable` : `${baseName}-${size}`
      entries.push({ name, baseName, size, svg: iconMap[baseName][size] })
    }
  }

  if (entries.length > 0) {
    categories.push({ title: cat.title, icons: entries })
  }
}

// Scalable icons as their own section
const scalableEntries = []
for (const [baseName, sizes] of Object.entries(iconMap)) {
  if (sizes[48] && !categorized.has(baseName)) {
    scalableEntries.push({ name: `${baseName}-scalable`, baseName, size: 48, svg: sizes[48] })
  } else if (sizes[48] && categorized.has(baseName)) {
    // Already included in a category
  }
}
// Also collect any scalable versions of categorized icons
for (const [baseName, sizes] of Object.entries(iconMap)) {
  if (sizes[48]) {
    scalableEntries.push({ name: `${baseName}-scalable`, baseName, size: 48, svg: sizes[48] })
  }
}
// Dedupe
const scalableNames = new Set()
const dedupedScalable = scalableEntries.filter(e => {
  if (scalableNames.has(e.name)) return false
  scalableNames.add(e.name)
  return true
})
if (dedupedScalable.length > 0) {
  categories.push({ title: 'Scalable', icons: dedupedScalable })
}

// Uncategorized icons
const uncategorizedEntries = []
for (const [baseName, sizes] of Object.entries(iconMap)) {
  if (categorized.has(baseName)) continue
  const sizeList = Object.keys(sizes).map(Number).filter(s => s !== 48).sort((a, b) => a - b)
  for (const size of sizeList) {
    uncategorizedEntries.push({ name: `${baseName}-${size}`, baseName, size, svg: sizes[size] })
  }
}
if (uncategorizedEntries.length > 0) {
  categories.push({ title: 'Other', icons: uncategorizedEntries })
}

const totalIcons = categories.reduce((sum, c) => sum + c.icons.length, 0)

const output = {
  source: inputDir,
  generated: new Date().toISOString(),
  count: totalIcons,
  categories,
}

writeFileSync(outputPath, JSON.stringify(output, null, 2))

console.log(`Parsed ${totalIcons} icons in ${categories.length} categories:`)
for (const cat of categories) {
  console.log(`  ${cat.title}: ${cat.icons.length} icons`)
}
console.log(`Output: ${outputPath}`)
