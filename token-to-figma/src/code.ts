// Token to Figma — Plugin Main
// Creates Figma variable collections and variables from parsed token JSON.
// Supports COLOR (with light/dark modes), FLOAT, and STRING variable types.

interface TokenColor {
  r: number
  g: number
  b: number
  a: number
}

interface TokenEntry {
  type: 'COLOR' | 'FLOAT' | 'STRING'
  light: TokenColor | number | string
  dark?: TokenColor | number | string
  scopes?: string[]
  _lightRaw?: string
  _darkRaw?: string
}

interface ShadowLayer {
  x: number
  y: number
  blur: number
  spread: number
  color: TokenColor
}

interface EffectStyleEntry {
  type: 'EFFECT'
  layers: ShadowLayer[]
}

interface TextStyleEntry {
  type: 'TEXT'
  fontFamily: string
  fontStyle: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  letterSpacingUnit: 'PIXELS' | 'PERCENT'
  textCase?: 'UPPER' | 'LOWER' | 'TITLE' | 'NONE'
  textDecoration?: 'UNDERLINE' | 'STRIKETHROUGH' | 'NONE'
}

interface ColorRef {
  var?: string
  fallback: string
}

interface ComponentSizeSpec {
  height: number
  paddingH: number
  maxWidth: number
  fontSize: number
  lineHeight: number
  letterSpacing: number
  spinnerSize: number
}

interface ComponentStyleSpec {
  fill: ColorRef | null
  textColor: ColorRef
  border: { color: ColorRef; weight: number } | null
  stateLayerColor: string
  stateOpacity: { hover: number; pressed: number }
  disabledFill: ColorRef | null
  disabledTextColor: ColorRef
  disabledBorderColor?: ColorRef
  paddingOverride?: Record<string, number>
}

interface ComponentSpec {
  name: string
  variantProperties: Record<string, string[]>
  componentProperties?: Record<string, {
    type: 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'
    defaultValue?: any
    defaultName?: string
  }>
  base: {
    layoutMode: string
    primaryAxisAlignItems: string
    counterAxisAlignItems: string
    itemSpacing: number
    minWidth: number
    cornerRadius: number
    fontFamily: string
    fontWeight: number
    labelText: string
    clipsContent: boolean
    iconSize?: number
  }
  sizes: Record<string, ComponentSizeSpec>
  styles: Record<string, ComponentStyleSpec>
}

interface TokenPayload {
  source: string
  generated: string
  collections: Record<string, Record<string, TokenEntry>>
  effectStyles?: Record<string, EffectStyleEntry>
  textStyles?: Record<string, TextStyleEntry>
  components?: ComponentSpec[]
}

figma.showUI(__html__, { width: 500, height: 460 })

figma.ui.onmessage = async (msg: { type: string; payload?: any }) => {
  if (msg.type === 'import-tokens' && msg.payload) {
    try {
      const result = await importTokens(msg.payload)
      figma.ui.postMessage({ type: 'result-tokens', ...result })
    } catch (err: any) {
      figma.ui.postMessage({ type: 'error', message: err.message || String(err) })
    }
  }

  if (msg.type === 'import-components' && msg.payload) {
    try {
      const specs: ComponentSpec[] = msg.payload
      const result = await importComponents(specs)
      figma.ui.postMessage({ type: 'result-components', ...result })
    } catch (err: any) {
      figma.ui.postMessage({ type: 'error', message: err.message || String(err) })
    }
  }

  if (msg.type === 'import-icons' && msg.payload) {
    try {
      const result = await importIcons(msg.payload)
      figma.ui.postMessage({ type: 'result-icons', ...result })
    } catch (err: any) {
      figma.ui.postMessage({ type: 'error', message: err.message || String(err) })
    }
  }

  if (msg.type === 'cancel') {
    figma.closePlugin()
  }
}

/** Find a local component by name across all pages */
function findComponent(name: string): ComponentNode | null {
  var pages = figma.root.children
  for (var p = 0; p < pages.length; p++) {
    var nodes = pages[p].findAllWithCriteria({ types: ['COMPONENT'] })
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].name === name) return nodes[i] as ComponentNode
    }
  }
  return null
}

/** Find a variable by name across all collections */
function findVariable(name: string): Variable | null {
  var collections = figma.variables.getLocalVariableCollections()
  for (var i = 0; i < collections.length; i++) {
    var varIds = collections[i].variableIds
    for (var j = 0; j < varIds.length; j++) {
      var v = figma.variables.getVariableById(varIds[j])
      if (v && v.name === name) return v
    }
  }
  return null
}

/** Parse hex to Figma RGBA */
function hexToFigmaColor(hex: string): RGBA {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
  if (hex.length === 6) hex += 'ff'
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
    a: parseInt(hex.slice(6, 8), 16) / 255
  }
}

/** Create a SolidPaint, optionally bound to a variable */
function makeBoundPaint(ref: ColorRef): SolidPaint {
  var color = hexToFigmaColor(ref.fallback)
  var paint: SolidPaint = { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }
  if (ref.var) {
    var variable = findVariable(ref.var)
    if (variable) {
      paint = figma.variables.setBoundVariableForPaint(paint, 'color', variable)
    }
  }
  return paint
}

/** Set fill on a node, binding to variable if found */
function setFill(node: GeometryMixin & MinimalFillsMixin, ref: ColorRef | null): void {
  if (!ref) {
    node.fills = []
    return
  }
  node.fills = [makeBoundPaint(ref)]
}

/** Set stroke on a node, binding to variable if found */
function setStroke(node: GeometryMixin & MinimalStrokesMixin, ref: ColorRef, weight: number): void {
  node.strokes = [makeBoundPaint(ref)]
  node.strokeWeight = weight
  node.strokeAlign = 'INSIDE'
}

async function importTokens(data: TokenPayload) {
  const stats = { collections: 0, variables: 0, modes: 0, effectStyles: 0, textStyles: 0 }

  for (const [collectionName, tokens] of Object.entries(data.collections)) {
    const collection = figma.variables.createVariableCollection(collectionName)
    stats.collections++

    // Rename the default mode to "Light"
    const lightModeId = collection.modes[0].modeId
    collection.renameMode(lightModeId, 'Light')

    // Only add Dark mode if any token in this collection has a dark value
    const hasDark = Object.values(tokens).some(function(t) { return t.dark != null })
    var darkModeId: string | null = null
    if (hasDark) {
      darkModeId = collection.addMode('Dark')
      stats.modes++
    }

    for (const [tokenName, entry] of Object.entries(tokens)) {
      var resolvedType: VariableResolvedDataType
      if (entry.type === 'COLOR') {
        resolvedType = 'COLOR'
      } else if (entry.type === 'FLOAT') {
        resolvedType = 'FLOAT'
      } else if (entry.type === 'STRING') {
        resolvedType = 'STRING'
      } else {
        continue
      }

      const variable = figma.variables.createVariable(
        tokenName,
        collection,
        resolvedType
      )

      // Apply Figma variable scopes if provided
      if (entry.scopes && entry.scopes.length > 0) {
        variable.scopes = entry.scopes as VariableScope[]
      }

      // Set light mode value
      if (entry.type === 'COLOR') {
        var c = entry.light as TokenColor
        var rgba: RGBA = { r: c.r, g: c.g, b: c.b, a: c.a }
        variable.setValueForMode(lightModeId, rgba)
      } else {
        variable.setValueForMode(lightModeId, entry.light)
      }

      // Set dark mode value if it exists
      if (darkModeId && entry.dark != null) {
        if (entry.type === 'COLOR') {
          var dc = entry.dark as TokenColor
          var darkRgba: RGBA = { r: dc.r, g: dc.g, b: dc.b, a: dc.a }
          variable.setValueForMode(darkModeId, darkRgba)
        } else {
          variable.setValueForMode(darkModeId, entry.dark)
        }
      }

      stats.variables++
    }
  }

  // Create effect styles (shadows)
  if (data.effectStyles) {
    for (const [styleName, entry] of Object.entries(data.effectStyles)) {
      var style = figma.createEffectStyle()
      style.name = styleName

      var effects: Effect[] = []
      for (var i = 0; i < entry.layers.length; i++) {
        var layer = entry.layers[i]
        effects.push({
          type: 'DROP_SHADOW',
          color: { r: layer.color.r, g: layer.color.g, b: layer.color.b, a: layer.color.a },
          offset: { x: layer.x, y: layer.y },
          radius: layer.blur,
          spread: layer.spread,
          visible: true,
          blendMode: 'NORMAL'
        })
      }
      style.effects = effects
      stats.effectStyles++
    }
  }

  // Create text styles
  if (data.textStyles) {
    for (const [styleName, entry] of Object.entries(data.textStyles)) {
      var fontName: FontName = { family: entry.fontFamily, style: entry.fontStyle }

      // Load the font before setting properties
      try {
        await figma.loadFontAsync(fontName)
      } catch (e) {
        // If the exact font isn't available, try Inter as fallback
        fontName = { family: 'Inter', style: entry.fontStyle }
        try {
          await figma.loadFontAsync(fontName)
        } catch (e2) {
          fontName = { family: 'Inter', style: 'Regular' }
          await figma.loadFontAsync(fontName)
        }
      }

      var textStyle = figma.createTextStyle()
      textStyle.name = styleName
      textStyle.fontName = fontName
      textStyle.fontSize = entry.fontSize

      if (entry.lineHeight > 0) {
        textStyle.lineHeight = { value: entry.lineHeight, unit: 'PIXELS' }
      }

      if (entry.letterSpacing !== 0) {
        textStyle.letterSpacing = { value: entry.letterSpacing, unit: entry.letterSpacingUnit }
      } else {
        textStyle.letterSpacing = { value: 0, unit: 'PIXELS' }
      }

      if (entry.textCase && entry.textCase !== 'NONE') {
        textStyle.textCase = entry.textCase as TextCase
      }

      if (entry.textDecoration && entry.textDecoration !== 'NONE') {
        textStyle.textDecoration = entry.textDecoration as TextDecoration
      }

      stats.textStyles++
    }
  }

  return stats
}

function findVariant(variants: ComponentNode[], state: string, size: string, style: string): ComponentNode | null {
  var target = 'state=' + state + ', size=' + size + ', style=' + style
  for (var i = 0; i < variants.length; i++) {
    if (variants[i].name === target) return variants[i]
  }
  return null
}

async function importComponents(specs: ComponentSpec[]) {
  var stats: Record<string, any> = { components: 0, variants: 0 }

  for (var ci = 0; ci < specs.length; ci++) {
    var spec = specs[ci]
    var variants: ComponentNode[] = []

    var styleNames = spec.variantProperties['style'] || []
    var sizeNames = spec.variantProperties['size'] || []
    var stateNames = spec.variantProperties['state'] || []

    for (var si = 0; si < styleNames.length; si++) {
      var styleName = styleNames[si]
      var styleSpec = spec.styles[styleName]

      for (var szi = 0; szi < sizeNames.length; szi++) {
        var sizeName = sizeNames[szi]
        var sizeSpec = spec.sizes[sizeName]

        for (var sti = 0; sti < stateNames.length; sti++) {
          var stateName = stateNames[sti]
          var isDisabled = stateName === 'disabled'
          var isLoading = stateName === 'loading'
          var isHover = stateName === 'hover'
          var isPressed = stateName === 'pressed'

          var comp = figma.createComponent()
          comp.name = 'state=' + stateName + ', size=' + sizeName + ', style=' + styleName

          comp.layoutMode = 'HORIZONTAL'
          comp.primaryAxisAlignItems = 'CENTER'
          comp.counterAxisAlignItems = 'CENTER'
          comp.itemSpacing = spec.base.itemSpacing

          var paddingH = (styleSpec.paddingOverride && styleSpec.paddingOverride[sizeName])
            ? styleSpec.paddingOverride[sizeName]
            : sizeSpec.paddingH
          comp.paddingLeft = paddingH
          comp.paddingRight = paddingH
          comp.paddingTop = 0
          comp.paddingBottom = 0
          comp.resize(200, sizeSpec.height)
          comp.primaryAxisSizingMode = 'AUTO'
          comp.counterAxisSizingMode = 'FIXED'
          comp.minWidth = spec.base.minWidth
          comp.maxWidth = sizeSpec.maxWidth
          comp.cornerRadius = spec.base.cornerRadius
          comp.clipsContent = spec.base.clipsContent

          if (isDisabled && styleSpec.disabledFill) {
            setFill(comp, styleSpec.disabledFill)
          } else {
            setFill(comp, styleSpec.fill)
          }

          if (styleSpec.border) {
            if (isDisabled && styleSpec.disabledBorderColor) {
              setStroke(comp, styleSpec.disabledBorderColor, styleSpec.border.weight)
            } else {
              setStroke(comp, styleSpec.border.color, styleSpec.border.weight)
            }
          }

          // Touch target (absolute, hidden by default)
          var touchTarget = figma.createFrame()
          touchTarget.name = 'touch target'
          comp.appendChild(touchTarget)
          touchTarget.layoutPositioning = 'ABSOLUTE'
          touchTarget.x = 0
          touchTarget.y = 0
          touchTarget.resize(comp.width, sizeSpec.height)
          touchTarget.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
          touchTarget.fills = [{ type: 'SOLID', color: { r: 0.87, g: 0.27, b: 0.56 }, opacity: 0.16 }]
          touchTarget.visible = false

          // State layer
          var stateLayer = figma.createFrame()
          stateLayer.name = 'state layer'
          comp.appendChild(stateLayer)
          stateLayer.layoutPositioning = 'ABSOLUTE'
          stateLayer.x = 0
          stateLayer.y = 0
          stateLayer.resize(comp.width, sizeSpec.height)
          stateLayer.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
          stateLayer.fills = []
          stateLayer.clipsContent = true

          var stateFill = figma.createFrame()
          stateFill.name = 'state-fill'
          stateLayer.appendChild(stateFill)
          stateFill.x = 0
          stateFill.y = 0
          stateFill.resize(comp.width, sizeSpec.height)
          stateFill.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
          stateFill.cornerRadius = 100

          if (isHover || isPressed) {
            var stateColor = hexToFigmaColor(styleSpec.stateLayerColor)
            var stateOp = isHover ? styleSpec.stateOpacity.hover : styleSpec.stateOpacity.pressed
            stateFill.fills = [{ type: 'SOLID', color: { r: stateColor.r, g: stateColor.g, b: stateColor.b }, opacity: stateOp }]
          } else {
            stateFill.fills = []
          }

          // Leading icon: wrapper frame (boolean visibility) → instance inside (instance swap)
          var iconSize = spec.base.iconSize || 16
          var leadingIconDefault = spec.componentProperties && spec.componentProperties['leading icon']
            ? spec.componentProperties['leading icon'].defaultName : null
          var leadingIconComp = leadingIconDefault ? findComponent(leadingIconDefault) : null

          var leadingWrapper = figma.createFrame()
          leadingWrapper.name = 'leading icon'
          leadingWrapper.resize(iconSize, iconSize)
          leadingWrapper.fills = []
          leadingWrapper.clipsContent = false
          leadingWrapper.visible = false
          comp.appendChild(leadingWrapper)

          if (leadingIconComp) {
            var leadingInstance = leadingIconComp.createInstance()
            leadingInstance.name = 'leading icon swap'
            leadingWrapper.appendChild(leadingInstance)
            leadingInstance.x = 0
            leadingInstance.y = 0
          }

          // Label / spinner
          var textColorRef = isDisabled ? styleSpec.disabledTextColor : styleSpec.textColor
          var fontStyle = spec.base.fontWeight >= 700 ? 'Bold' : 'Regular'
          if (styleName === 'secondary') fontStyle = 'Regular'

          var labelFont: FontName = { family: spec.base.fontFamily, style: fontStyle }
          try {
            await figma.loadFontAsync(labelFont)
          } catch (e) {
            labelFont = { family: 'Inter', style: fontStyle }
            try {
              await figma.loadFontAsync(labelFont)
            } catch (e2) {
              labelFont = { family: 'Inter', style: 'Regular' }
              await figma.loadFontAsync(labelFont)
            }
          }

          if (isLoading) {
            var spinnerFrame = figma.createFrame()
            spinnerFrame.name = 'spinner'
            spinnerFrame.resize(sizeSpec.spinnerSize, sizeSpec.spinnerSize)
            spinnerFrame.cornerRadius = sizeSpec.spinnerSize / 2
            spinnerFrame.fills = []
            var spinnerColor = hexToFigmaColor(textColorRef.fallback)
            spinnerFrame.strokes = [{ type: 'SOLID', color: { r: spinnerColor.r, g: spinnerColor.g, b: spinnerColor.b }, opacity: 0.3 }]
            spinnerFrame.strokeWeight = 2
            comp.appendChild(spinnerFrame)
          } else {
            var label = figma.createText()
            label.name = spec.base.labelText
            label.fontName = labelFont
            label.fontSize = sizeSpec.fontSize
            label.lineHeight = { value: sizeSpec.lineHeight, unit: 'PIXELS' }
            if (sizeSpec.letterSpacing !== 0) {
              label.letterSpacing = { value: sizeSpec.letterSpacing, unit: 'PIXELS' }
            }
            label.characters = spec.base.labelText

            label.fills = [makeBoundPaint(textColorRef)]
            comp.appendChild(label)
          }

          // Trailing icon: wrapper frame (boolean visibility) → instance inside (instance swap)
          var trailingIconDefault = spec.componentProperties && spec.componentProperties['trailing icon']
            ? spec.componentProperties['trailing icon'].defaultName : null
          var trailingIconComp = trailingIconDefault ? findComponent(trailingIconDefault) : null

          var trailingWrapper = figma.createFrame()
          trailingWrapper.name = 'trailing icon'
          trailingWrapper.resize(iconSize, iconSize)
          trailingWrapper.fills = []
          trailingWrapper.clipsContent = false
          trailingWrapper.visible = false
          comp.appendChild(trailingWrapper)

          if (trailingIconComp) {
            var trailingInstance = trailingIconComp.createInstance()
            trailingInstance.name = 'trailing icon swap'
            trailingWrapper.appendChild(trailingInstance)
            trailingInstance.x = 0
            trailingInstance.y = 0
          }

          variants.push(comp)
          stats.variants++
        }
      }
    }

    if (variants.length > 0) {
      var componentSet = figma.combineAsVariants(variants, figma.currentPage)
      componentSet.name = spec.name
      componentSet.layoutMode = 'NONE'

      // Add component properties on the ComponentSet, then wire child layers
      if (spec.componentProperties) {
        var propKeys: Record<string, string> = {}
        var debugLog: string[] = []

        // Step 1: Create properties on the ComponentSet
        var propEntries = Object.entries(spec.componentProperties)
        for (var pi = 0; pi < propEntries.length; pi++) {
          var propName = propEntries[pi][0]
          var propDef = propEntries[pi][1]

          try {
            if (propDef.type === 'BOOLEAN') {
              propKeys[propName] = componentSet.addComponentProperty(propName, 'BOOLEAN', propDef.defaultValue === true)
              debugLog.push('Created BOOLEAN: ' + propName + ' → key: ' + propKeys[propName])
            } else if (propDef.type === 'TEXT') {
              propKeys[propName] = componentSet.addComponentProperty(propName, 'TEXT', propDef.defaultValue || '')
              debugLog.push('Created TEXT: ' + propName + ' → key: ' + propKeys[propName])
            } else if (propDef.type === 'INSTANCE_SWAP') {
              // Find the default component for the instance swap
              var defaultComp = propDef.defaultName ? findComponent(propDef.defaultName) : null
              if (defaultComp) {
                propKeys[propName] = componentSet.addComponentProperty(propName, 'INSTANCE_SWAP', defaultComp.id)
                debugLog.push('Created INSTANCE_SWAP: ' + propName + ' → key: ' + propKeys[propName] + ' (default: ' + propDef.defaultName + ')')
              } else {
                debugLog.push('SKIPPED INSTANCE_SWAP ' + propName + ': component "' + propDef.defaultName + '" not found')
              }
            }
          } catch (e: any) {
            debugLog.push('FAILED ' + propName + ': ' + (e.message || String(e)))
          }
        }

        // Step 2: Wire references on all variants' children
        var wiredCount = 0
        for (var vi2 = 0; vi2 < variants.length; vi2++) {
          var variant = variants[vi2]

          for (var ci2 = 0; ci2 < variant.children.length; ci2++) {
            var child = variant.children[ci2]
            var childName = child.name

            if (propKeys['touch target'] && childName === 'touch target') {
              child.componentPropertyReferences = { visible: propKeys['touch target'] }
              wiredCount++
            }
            // Boolean: wrapper frame gets visibility toggle
            if (propKeys['leading icon?'] && childName === 'leading icon' && child.type === 'FRAME') {
              child.componentPropertyReferences = { visible: propKeys['leading icon?'] }
              wiredCount++
              // Instance swap: find the instance inside the wrapper
              if (propKeys['leading icon']) {
                var wrapperFrame = child as FrameNode
                for (var wi = 0; wi < wrapperFrame.children.length; wi++) {
                  if (wrapperFrame.children[wi].type === 'INSTANCE') {
                    wrapperFrame.children[wi].componentPropertyReferences = { mainComponent: propKeys['leading icon'] }
                    wiredCount++
                    break
                  }
                }
              }
            }
            if (propKeys['trailing icon?'] && childName === 'trailing icon' && child.type === 'FRAME') {
              child.componentPropertyReferences = { visible: propKeys['trailing icon?'] }
              wiredCount++
              if (propKeys['trailing icon']) {
                var trailWrapperFrame = child as FrameNode
                for (var twi = 0; twi < trailWrapperFrame.children.length; twi++) {
                  if (trailWrapperFrame.children[twi].type === 'INSTANCE') {
                    trailWrapperFrame.children[twi].componentPropertyReferences = { mainComponent: propKeys['trailing icon'] }
                    wiredCount++
                    break
                  }
                }
              }
            }
            if (propKeys['label'] && child.type === 'TEXT' && child.name === spec.base.labelText) {
              child.componentPropertyReferences = { characters: propKeys['label'] }
              wiredCount++
            }
          }
        }
        debugLog.push('Wired ' + wiredCount + ' references across ' + variants.length + ' variants')

        stats.debug = debugLog.join('\n')
      }

      // Arrange variants matching live site layout:
      // Per style row: [default L M S] [disabled L M S] [loading L M S]
      var xGap = 16
      var yGap = 32
      var stateGroupGap = 32
      var currentY = 40
      var stateOrder = ['default', 'hover', 'pressed', 'disabled', 'loading']
      var maxX = 0

      for (var styleIdx = 0; styleIdx < styleNames.length; styleIdx++) {
        var currentStyleName = styleNames[styleIdx]
        var currentX = 0
        var maxRowHeight = 0

        for (var stIdx = 0; stIdx < stateOrder.length; stIdx++) {
          var currentState = stateOrder[stIdx]

          for (var szIdx = 0; szIdx < sizeNames.length; szIdx++) {
            var v = findVariant(variants, currentState, sizeNames[szIdx], currentStyleName)
            if (v) {
              v.x = currentX
              v.y = currentY
              currentX += v.width + xGap
              if (v.height > maxRowHeight) maxRowHeight = v.height
            }
          }

          currentX += stateGroupGap
        }

        if (currentX > maxX) maxX = currentX
        currentY += maxRowHeight + yGap
      }

      componentSet.resize(maxX + 40, currentY + 40)
      stats.components++
    }
  }

  return stats
}

interface IconEntry {
  name: string
  baseName?: string
  size: number
  svg: string
}

interface IconCategory {
  title: string
  icons: IconEntry[]
}

interface IconPayload {
  icons?: IconEntry[]
  categories?: IconCategory[]
}

async function importIcons(data: IconPayload) {
  var stats: Record<string, any> = { icons: 0, failed: 0 }
  var debugLog: string[] = []

  // Support both flat (old) and categorized (new) formats
  var categories: IconCategory[]
  if (data.categories) {
    categories = data.categories
  } else if (data.icons) {
    categories = [{ title: 'Icons', icons: data.icons }]
  } else {
    return stats
  }

  var cellWidth = 96
  var cellHeight = 100
  var iconDisplaySize = 24
  var scalableDisplaySize = 48
  var colsPerRow = 16
  var sectionGap = 60
  var headerHeight = 40
  var globalY = 0

  // Load font for labels
  var labelFont: FontName = { family: 'Inter', style: 'Regular' }
  try {
    await figma.loadFontAsync(labelFont)
  } catch (e) {
    labelFont = { family: 'Roboto', style: 'Regular' }
    await figma.loadFontAsync(labelFont)
  }

  for (var catIdx = 0; catIdx < categories.length; catIdx++) {
    var category = categories[catIdx]
    var isScalable = category.title === 'Scalable'
    var currentCellW = isScalable ? 120 : cellWidth
    var currentCellH = isScalable ? 120 : cellHeight

    debugLog.push(category.title + ': ' + category.icons.length + ' icons')

    // Section header
    var header = figma.createText()
    header.fontName = labelFont
    header.fontSize = 20
    header.lineHeight = { value: 28, unit: 'PIXELS' }
    header.characters = 'Icons \u2014 ' + category.title
    header.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }]
    header.x = 0
    header.y = globalY

    globalY += headerHeight

    var col = 0
    var row = 0

    for (var gi = 0; gi < category.icons.length; gi++) {
      var icon = category.icons[gi]

      try {
        var svgNode = figma.createNodeFromSvg(icon.svg)

        var comp = figma.createComponent()
        comp.name = icon.name
        comp.resize(icon.size, icon.size)
        comp.fills = []
        comp.clipsContent = true

        var svgChildren = []
        for (var ci3 = 0; ci3 < svgNode.children.length; ci3++) {
          svgChildren.push(svgNode.children[ci3])
        }
        for (var ci4 = 0; ci4 < svgChildren.length; ci4++) {
          var svgChild = svgChildren[ci4]
          comp.appendChild(svgChild)
          try {
            svgChild.constraints = { horizontal: 'SCALE', vertical: 'SCALE' }
          } catch (e2) {
            // Some node types don't support constraints
          }
        }
        svgNode.remove()

        // Center icon in cell
        var iconCenterX = col * currentCellW + (currentCellW - icon.size) / 2
        var iconCenterY = globalY + row * currentCellH + 4
        comp.x = Math.round(iconCenterX)
        comp.y = Math.round(iconCenterY)

        // Label below icon
        var iconLabel = figma.createText()
        iconLabel.fontName = labelFont
        iconLabel.fontSize = 9
        iconLabel.lineHeight = { value: 12, unit: 'PIXELS' }
        var displayName = (icon.baseName || icon.name).replace(/-/g, ' ')
        if (!isScalable) displayName += ' ' + icon.size
        iconLabel.characters = displayName
        iconLabel.fills = [{ type: 'SOLID', color: { r: 0.44, g: 0.44, b: 0.44 }, opacity: 1 }]
        iconLabel.textAlignHorizontal = 'CENTER'
        iconLabel.resize(currentCellW, iconLabel.height)
        iconLabel.x = col * currentCellW
        iconLabel.y = Math.round(iconCenterY + icon.size + 6)

        col++
        if (col >= colsPerRow) {
          col = 0
          row++
        }

        stats.icons++
      } catch (e: any) {
        debugLog.push('FAILED ' + icon.name + ': ' + (e.message || String(e)))
        stats.failed++
      }
    }

    globalY += (row + 1) * currentCellH + sectionGap
  }

  stats.debug = debugLog.join('\n')
  return stats
}
