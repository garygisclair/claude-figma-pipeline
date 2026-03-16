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

/** Resolve a numeric value that may be a variable reference { var, fallback } or a plain number */
function resolveNumber(val: any): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  if (typeof val === 'object' && val.fallback != null) return val.fallback
  return 0
}

/** Bind a numeric variable to a node property if val is a { var, fallback } object */
function bindNumberVariable(node: SceneNode, field: string, val: any): void {
  if (val != null && typeof val === 'object' && val.var) {
    var variable = findVariable(val.var)
    if (variable) {
      node.setBoundVariable(field as any, variable)
    }
  }
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
  var componentOffsetY = 0

  for (var ci = 0; ci < specs.length; ci++) {
    var spec = specs[ci] as any
    var variants: ComponentNode[] = []

    // Single component (no variants, just properties)
    if (spec.renderType === 'single' && spec.children) {
      var debugLog: string[] = []
      debugLog.push(spec.name + ': single component')

      var singleComp = figma.createComponent()
      singleComp.name = spec.name
      singleComp.fills = []

      // Layout
      if (spec.base.layoutMode) singleComp.layoutMode = spec.base.layoutMode as 'HORIZONTAL' | 'VERTICAL'
      if (spec.base.primaryAxisAlignItems) singleComp.primaryAxisAlignItems = spec.base.primaryAxisAlignItems as any
      if (spec.base.counterAxisAlignItems) singleComp.counterAxisAlignItems = spec.base.counterAxisAlignItems as any
      if (spec.base.primaryAxisSizingMode) singleComp.primaryAxisSizingMode = spec.base.primaryAxisSizingMode as any
      if (spec.base.counterAxisSizingMode) singleComp.counterAxisSizingMode = spec.base.counterAxisSizingMode as any
      if (spec.base.itemSpacing != null) { singleComp.itemSpacing = resolveNumber(spec.base.itemSpacing); bindNumberVariable(singleComp, 'itemSpacing', spec.base.itemSpacing) }
      if (spec.base.paddingTop != null) { singleComp.paddingTop = resolveNumber(spec.base.paddingTop); bindNumberVariable(singleComp, 'paddingTop', spec.base.paddingTop) }
      if (spec.base.paddingBottom != null) { singleComp.paddingBottom = resolveNumber(spec.base.paddingBottom); bindNumberVariable(singleComp, 'paddingBottom', spec.base.paddingBottom) }
      if (spec.base.paddingLeft != null) { singleComp.paddingLeft = resolveNumber(spec.base.paddingLeft); bindNumberVariable(singleComp, 'paddingLeft', spec.base.paddingLeft) }
      if (spec.base.paddingRight != null) { singleComp.paddingRight = resolveNumber(spec.base.paddingRight); bindNumberVariable(singleComp, 'paddingRight', spec.base.paddingRight) }
      if (spec.base.width) singleComp.resize(spec.base.width, spec.base.height || 20)
      if (spec.base.height && spec.base.counterAxisSizingMode === 'FIXED') {
        singleComp.resize(singleComp.width, spec.base.height)
      }
      if (spec.base.cornerRadius != null) singleComp.cornerRadius = spec.base.cornerRadius
      if (spec.base.clipsContent != null) singleComp.clipsContent = spec.base.clipsContent
      if (spec.base.fillColor) singleComp.fills = [makeBoundPaint(spec.base.fillColor)]
      if (spec.base.strokeColor) {
        singleComp.strokes = [makeBoundPaint(spec.base.strokeColor)]
        singleComp.strokeWeight = spec.base.strokeWeight || 1
        singleComp.strokeAlign = 'INSIDE'
      }
      if (spec.base.opacity != null) singleComp.opacity = spec.base.opacity

      // Create component properties first
      var singlePropKeys: Record<string, string> = {}
      if (spec.componentProperties) {
        var cpEntries = Object.entries(spec.componentProperties)
        for (var cpi = 0; cpi < cpEntries.length; cpi++) {
          var cpName = (cpEntries[cpi] as any)[0] as string
          var cpDef = (cpEntries[cpi] as any)[1] as any
          try {
            if (cpDef.type === 'BOOLEAN') {
              singlePropKeys[cpName] = singleComp.addComponentProperty(cpName, 'BOOLEAN', cpDef.defaultValue === true)
              debugLog.push('Created BOOLEAN: ' + cpName)
            } else if (cpDef.type === 'TEXT') {
              singlePropKeys[cpName] = singleComp.addComponentProperty(cpName, 'TEXT', cpDef.defaultValue || '')
              debugLog.push('Created TEXT: ' + cpName)
            }
          } catch (e: any) {
            debugLog.push('FAILED prop ' + cpName + ': ' + e.message)
          }
        }
      }

      // Build children recursively
      async function buildChildren(parentNode: FrameNode | ComponentNode, childSpecs: any[]) {
        for (var chi = 0; chi < childSpecs.length; chi++) {
          var childSpec = childSpecs[chi]

          if (childSpec.type === 'FRAME') {
            var frame = figma.createFrame()
            frame.name = childSpec.name || 'frame'
            frame.fills = childSpec.fills || []
            if (childSpec.layoutMode) frame.layoutMode = childSpec.layoutMode as any
            if (childSpec.primaryAxisAlignItems) frame.primaryAxisAlignItems = childSpec.primaryAxisAlignItems as any
            if (childSpec.counterAxisAlignItems) frame.counterAxisAlignItems = childSpec.counterAxisAlignItems as any
            if (childSpec.primaryAxisSizingMode === 'FILL') {
              // FILL is set via layoutGrow after appending
            } else if (childSpec.primaryAxisSizingMode) {
              frame.primaryAxisSizingMode = childSpec.primaryAxisSizingMode as any
            }
            if (childSpec.counterAxisSizingMode) frame.counterAxisSizingMode = childSpec.counterAxisSizingMode as any
            if (childSpec.itemSpacing != null) { frame.itemSpacing = resolveNumber(childSpec.itemSpacing); bindNumberVariable(frame, 'itemSpacing', childSpec.itemSpacing) }
            if (childSpec.paddingTop != null) { frame.paddingTop = resolveNumber(childSpec.paddingTop); bindNumberVariable(frame, 'paddingTop', childSpec.paddingTop) }
            if (childSpec.paddingBottom != null) { frame.paddingBottom = resolveNumber(childSpec.paddingBottom); bindNumberVariable(frame, 'paddingBottom', childSpec.paddingBottom) }
            if (childSpec.paddingLeft != null) { frame.paddingLeft = resolveNumber(childSpec.paddingLeft); bindNumberVariable(frame, 'paddingLeft', childSpec.paddingLeft) }
            if (childSpec.paddingRight != null) { frame.paddingRight = resolveNumber(childSpec.paddingRight); bindNumberVariable(frame, 'paddingRight', childSpec.paddingRight) }
            if (childSpec.cornerRadius != null) frame.cornerRadius = childSpec.cornerRadius
            if (childSpec.clipsContent != null) frame.clipsContent = childSpec.clipsContent
            if (childSpec.fillColor) frame.fills = [makeBoundPaint(childSpec.fillColor)]
            if (childSpec.strokeColor) {
              frame.strokes = [makeBoundPaint(childSpec.strokeColor)]
              frame.strokeWeight = childSpec.strokeWeight || 1
              frame.strokeAlign = 'INSIDE'
            }
            if (childSpec.opacity != null) frame.opacity = childSpec.opacity
            if (childSpec.width && childSpec.height) frame.resize(childSpec.width, childSpec.height)
            if (childSpec.visible === false) frame.visible = false
            parentNode.appendChild(frame)

            // Set FILL after appending to auto-layout parent
            if (childSpec.primaryAxisSizingMode === 'FILL' || childSpec.layoutGrow === 1) {
              frame.layoutGrow = 1
            }
            // Layout sizing (HUG/FILL/FIXED) — set after appending
            if (childSpec.layoutSizingHorizontal) frame.layoutSizingHorizontal = childSpec.layoutSizingHorizontal as any
            if (childSpec.layoutSizingVertical) frame.layoutSizingVertical = childSpec.layoutSizingVertical as any

            // Wire property references on frame (e.g. visibility toggle)
            if (childSpec.propertyRef) {
              var frameRefs: Record<string, string> = {}
              for (var frKey of Object.keys(childSpec.propertyRef)) {
                var frPropName = childSpec.propertyRef[frKey]
                if (singlePropKeys[frPropName]) {
                  frameRefs[frKey] = singlePropKeys[frPropName]
                }
              }
              if (Object.keys(frameRefs).length > 0) {
                frame.componentPropertyReferences = frameRefs
              }
            }

            if (childSpec.children) {
              await buildChildren(frame, childSpec.children)
            }
          } else if (childSpec.type === 'TEXT') {
            var fontStyle2 = childSpec.fontStyle || 'Regular'
            var textFont: FontName = { family: childSpec.fontFamily || spec.base.fontFamily, style: fontStyle2 }
            try { await figma.loadFontAsync(textFont) } catch (e) {
              textFont = { family: 'Inter', style: fontStyle2 }
              try { await figma.loadFontAsync(textFont) } catch (e2) {
                textFont = { family: 'Inter', style: 'Regular' }
                await figma.loadFontAsync(textFont)
              }
            }

            var textNode = figma.createText()
            textNode.name = childSpec.name || 'text'
            textNode.fontName = textFont
            textNode.fontSize = resolveNumber(childSpec.fontSize) || 14
            bindNumberVariable(textNode, 'fontSize', childSpec.fontSize)
            if (childSpec.lineHeight) {
              textNode.lineHeight = { value: resolveNumber(childSpec.lineHeight), unit: 'PIXELS' }
              bindNumberVariable(textNode, 'lineHeight', childSpec.lineHeight)
            }
            if (childSpec.letterSpacing) {
              textNode.letterSpacing = { value: resolveNumber(childSpec.letterSpacing), unit: 'PIXELS' }
              bindNumberVariable(textNode, 'letterSpacing', childSpec.letterSpacing)
            }
            if (childSpec.textCase === 'UPPER') textNode.textCase = 'UPPER'
            textNode.characters = childSpec.characters || ''
            if (childSpec.textColor) textNode.fills = [makeBoundPaint(childSpec.textColor)]
            if (childSpec.visible === false) textNode.visible = false
            parentNode.appendChild(textNode)
            if (childSpec.layoutGrow === 1) textNode.layoutGrow = 1
            if (childSpec.layoutSizingHorizontal) textNode.layoutSizingHorizontal = childSpec.layoutSizingHorizontal as any
            if (childSpec.layoutSizingVertical) textNode.layoutSizingVertical = childSpec.layoutSizingVertical as any

            // Wire property references
            if (childSpec.propertyRef) {
              var refs: Record<string, string> = {}
              for (var prKey of Object.keys(childSpec.propertyRef)) {
                var propName2 = childSpec.propertyRef[prKey]
                if (singlePropKeys[propName2]) {
                  refs[prKey] = singlePropKeys[propName2]
                }
              }
              if (Object.keys(refs).length > 0) {
                textNode.componentPropertyReferences = refs
              }
            }
          } else if (childSpec.type === 'ICON_INSTANCE') {
            var iconComp = findComponent(childSpec.iconName)
            if (iconComp) {
              var iconInst = iconComp.createInstance()
              iconInst.name = childSpec.name || childSpec.iconName
              if (childSpec.visible === false) iconInst.visible = false
              parentNode.appendChild(iconInst)

              if (childSpec.propertyRef && childSpec.propertyRef.visible && singlePropKeys[childSpec.propertyRef.visible]) {
                iconInst.componentPropertyReferences = { visible: singlePropKeys[childSpec.propertyRef.visible] }
              }
            } else {
              // Placeholder frame
              var iconPlaceholder = figma.createFrame()
              iconPlaceholder.name = childSpec.name || 'icon'
              iconPlaceholder.resize(childSpec.size || 16, childSpec.size || 16)
              iconPlaceholder.fills = []
              if (childSpec.visible === false) iconPlaceholder.visible = false
              parentNode.appendChild(iconPlaceholder)
              debugLog.push('Icon not found: ' + childSpec.iconName + ', using placeholder')
            }
          } else if (childSpec.type === 'COMPONENT_INSTANCE') {
            var ciComp = findComponent(childSpec.componentName)
            if (ciComp) {
              var ciInst = ciComp.createInstance()
              ciInst.name = childSpec.name || childSpec.componentName
              if (childSpec.visible === false) ciInst.visible = false
              parentNode.appendChild(ciInst)
              // Layout sizing after appending
              if (childSpec.layoutSizingHorizontal) ciInst.layoutSizingHorizontal = childSpec.layoutSizingHorizontal as any
              if (childSpec.layoutSizingVertical) ciInst.layoutSizingVertical = childSpec.layoutSizingVertical as any
              // Set component property overrides by matching display name to internal key
              if (childSpec.overrides) {
                var instProps = ciInst.componentProperties
                var propMap: Record<string, string> = {}
                for (var ipKey of Object.keys(instProps)) {
                  // Internal keys look like "label#1234:0" — display name is before the #
                  var displayName = ipKey.split('#')[0]
                  propMap[displayName] = ipKey
                }
                var propsToSet: Record<string, string | boolean> = {}
                for (var ovKey of Object.keys(childSpec.overrides)) {
                  var internalKey = propMap[ovKey] || ovKey
                  propsToSet[internalKey] = childSpec.overrides[ovKey]
                }
                try {
                  ciInst.setProperties(propsToSet)
                } catch (e: any) {
                  debugLog.push('Override failed: ' + e.message)
                }
              }
            } else {
              var ciPlaceholder = figma.createFrame()
              ciPlaceholder.name = childSpec.name || 'component'
              ciPlaceholder.resize(childSpec.width || 60, childSpec.height || 30)
              ciPlaceholder.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }]
              parentNode.appendChild(ciPlaceholder)
              debugLog.push('Component not found: ' + childSpec.componentName + ', using placeholder')
            }
          }
        }
      }

      await buildChildren(singleComp, spec.children)

      stats.components++
      stats.debug = (stats.debug || '') + debugLog.join('\n') + '\n'
      continue
    }

    // Declarative variant components (children tree × variant matrix)
    if (spec.renderType === 'declarative' && spec.children) {
      var debugLog: string[] = []
      debugLog.push(spec.name + ': declarative')

      // Generate all variant combinations
      var vpKeys2 = Object.keys(spec.variantProperties)
      var combos: Record<string, string>[] = [{}]
      for (var vk = 0; vk < vpKeys2.length; vk++) {
        var key = vpKeys2[vk]
        var vals = spec.variantProperties[key]
        var newCombos: Record<string, string>[] = []
        for (var cc = 0; cc < combos.length; cc++) {
          for (var vv = 0; vv < vals.length; vv++) {
            var copy = Object.assign({}, combos[cc])
            copy[key] = vals[vv]
            newCombos.push(copy)
          }
        }
        combos = newCombos
      }

      // Load fonts upfront
      var declFont: FontName = { family: spec.base.fontFamily || 'Inter', style: 'Regular' }
      try { await figma.loadFontAsync(declFont) } catch (e) {
        declFont = { family: 'Inter', style: 'Regular' }
        await figma.loadFontAsync(declFont)
      }
      var declFontBold: FontName = { family: spec.base.fontFamily || 'Inter', style: 'Bold' }
      try { await figma.loadFontAsync(declFontBold) } catch (e) {
        declFontBold = { family: 'Inter', style: 'Bold' }
        await figma.loadFontAsync(declFontBold)
      }

      for (var comboIdx = 0; comboIdx < combos.length; comboIdx++) {
        var combo = combos[comboIdx]
        var variantName = vpKeys2.map(function(k) { return k + '=' + combo[k] }).join(', ')
        var currentState = combo['state'] || 'default'

        var comp = figma.createComponent()
        comp.name = variantName

        // Find per-variant overrides if spec.variants array exists
        var variantOverride: any = null
        if (spec.variants) {
          for (var voi = 0; voi < spec.variants.length; voi++) {
            if (spec.variants[voi].name === variantName) { variantOverride = spec.variants[voi]; break }
          }
        }

        // Base layout
        if (spec.base.layoutMode) comp.layoutMode = spec.base.layoutMode as any
        if (spec.base.primaryAxisAlignItems) comp.primaryAxisAlignItems = spec.base.primaryAxisAlignItems as any
        if (spec.base.counterAxisAlignItems) comp.counterAxisAlignItems = spec.base.counterAxisAlignItems as any
        if (spec.base.primaryAxisSizingMode) comp.primaryAxisSizingMode = spec.base.primaryAxisSizingMode as any
        if (spec.base.counterAxisSizingMode) comp.counterAxisSizingMode = spec.base.counterAxisSizingMode as any
        if (spec.base.itemSpacing != null) { comp.itemSpacing = resolveNumber(spec.base.itemSpacing); bindNumberVariable(comp, 'itemSpacing', spec.base.itemSpacing) }
        if (spec.base.paddingTop != null) { comp.paddingTop = resolveNumber(spec.base.paddingTop); bindNumberVariable(comp, 'paddingTop', spec.base.paddingTop) }
        if (spec.base.paddingBottom != null) { comp.paddingBottom = resolveNumber(spec.base.paddingBottom); bindNumberVariable(comp, 'paddingBottom', spec.base.paddingBottom) }
        if (spec.base.paddingLeft != null) { comp.paddingLeft = resolveNumber(spec.base.paddingLeft); bindNumberVariable(comp, 'paddingLeft', spec.base.paddingLeft) }
        if (spec.base.paddingRight != null) { comp.paddingRight = resolveNumber(spec.base.paddingRight); bindNumberVariable(comp, 'paddingRight', spec.base.paddingRight) }
        if (spec.base.cornerRadius != null) comp.cornerRadius = spec.base.cornerRadius
        if (spec.base.clipsContent != null) comp.clipsContent = spec.base.clipsContent
        var rootFill = (variantOverride && variantOverride.fillColor) || spec.base.fillColor
        if (rootFill) comp.fills = [makeBoundPaint(rootFill)]
        else comp.fills = []
        var rootStroke = (variantOverride && variantOverride.strokeColor) || spec.base.strokeColor
        if (rootStroke) {
          comp.strokes = [makeBoundPaint(rootStroke)]
          comp.strokeWeight = (variantOverride && variantOverride.strokeWeight) || spec.base.strokeWeight || 1
          comp.strokeAlign = 'INSIDE'
        }

        // State layer on root
        if (spec.stateLayer) {
          var slOpacity = spec.stateLayer.opacity[currentState] || 0
          if (slOpacity > 0) {
            var sl = figma.createFrame()
            sl.name = 'state layer'
            comp.appendChild(sl)
            sl.layoutPositioning = 'ABSOLUTE'
            sl.x = 0; sl.y = 0
            sl.resize(200, 32)
            sl.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
            sl.fills = [{ type: 'SOLID', color: hexToFigmaColor(spec.stateLayer.color), opacity: slOpacity }]
            sl.cornerRadius = spec.base.cornerRadius || 0
          }
        }

        // Build children with variant context
        async function buildDeclChildren(parentNode: FrameNode | ComponentNode, childSpecs: any[], variantCombo: Record<string, string>, state: string, override?: any) {
          for (var dci = 0; dci < childSpecs.length; dci++) {
            var cs = childSpecs[dci]

            // Skip if onlyForVariant doesn't match
            if (cs.onlyForVariant) {
              var skip = false
              for (var ofvKey of Object.keys(cs.onlyForVariant)) {
                if (variantCombo[ofvKey] !== cs.onlyForVariant[ofvKey]) { skip = true; break }
              }
              if (skip) continue
            }

            if (cs.type === 'FRAME') {
              var frame = figma.createFrame()
              frame.name = cs.name || 'frame'
              frame.fills = cs.fills || []
              if (cs.layoutMode) frame.layoutMode = cs.layoutMode as any
              if (cs.primaryAxisAlignItems) frame.primaryAxisAlignItems = cs.primaryAxisAlignItems as any
              if (cs.counterAxisAlignItems) frame.counterAxisAlignItems = cs.counterAxisAlignItems as any
              if (cs.primaryAxisSizingMode && cs.primaryAxisSizingMode !== 'FILL') frame.primaryAxisSizingMode = cs.primaryAxisSizingMode as any
              if (cs.counterAxisSizingMode) frame.counterAxisSizingMode = cs.counterAxisSizingMode as any
              if (cs.itemSpacing != null) frame.itemSpacing = cs.itemSpacing
              if (cs.paddingTop != null) frame.paddingTop = cs.paddingTop
              if (cs.paddingBottom != null) frame.paddingBottom = cs.paddingBottom
              if (cs.paddingLeft != null) frame.paddingLeft = cs.paddingLeft
              if (cs.paddingRight != null) frame.paddingRight = cs.paddingRight
              if (cs.cornerRadius != null) frame.cornerRadius = cs.cornerRadius
              if (cs.clipsContent != null) frame.clipsContent = cs.clipsContent
              if (cs.fillColor) frame.fills = [makeBoundPaint(cs.fillColor)]
              if (cs.width && cs.height) frame.resize(cs.width, cs.height)
              if (cs.visible === false) frame.visible = false
              parentNode.appendChild(frame)
              if (cs.primaryAxisSizingMode === 'FILL' || cs.layoutGrow === 1) frame.layoutGrow = 1
              if (cs.layoutSizingHorizontal) frame.layoutSizingHorizontal = cs.layoutSizingHorizontal as any
              if (cs.layoutSizingVertical) frame.layoutSizingVertical = cs.layoutSizingVertical as any

              // Per-child state layer
              if (cs.stateLayer) {
                var csSlOpacity = cs.stateLayer.opacity[state] || 0
                if (csSlOpacity > 0) {
                  var csSl = figma.createFrame()
                  csSl.name = 'state layer'
                  frame.appendChild(csSl)
                  csSl.layoutPositioning = 'ABSOLUTE'
                  csSl.x = 0; csSl.y = 0
                  csSl.resize(cs.width || 24, cs.height || 24)
                  csSl.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }
                  csSl.fills = [{ type: 'SOLID', color: hexToFigmaColor(cs.stateLayer.color), opacity: csSlOpacity }]
                  csSl.cornerRadius = cs.cornerRadius || 0
                }
              }

              if (cs.children) await buildDeclChildren(frame, cs.children, variantCombo, state, override)
            } else if (cs.type === 'TEXT') {
              var tf: FontName = cs.fontStyle === 'Bold' ? declFontBold : declFont
              var tn = figma.createText()
              tn.name = cs.name || 'text'
              tn.fontName = tf
              var csFontSize = cs.fontSize || 14
              tn.fontSize = resolveNumber(csFontSize)
              bindNumberVariable(tn, 'fontSize', csFontSize)
              if (cs.lineHeight) {
                tn.lineHeight = { value: resolveNumber(cs.lineHeight), unit: 'PIXELS' }
                bindNumberVariable(tn, 'lineHeight', cs.lineHeight)
              }
              if (cs.letterSpacing) {
                tn.letterSpacing = { value: resolveNumber(cs.letterSpacing), unit: 'PIXELS' }
                bindNumberVariable(tn, 'letterSpacing', cs.letterSpacing)
              }
              var oTextCase = (override && override.textCase) || cs.textCase
              if (oTextCase === 'UPPER') tn.textCase = 'UPPER'
              tn.characters = (override && override.labelText) || cs.characters || ''
              var oTextColor = (override && override.textColor) || cs.textColor
              if (oTextColor) tn.fills = [makeBoundPaint(oTextColor)]
              // Apply override fontSize if present
              if (override && override.fontSize) {
                tn.fontSize = resolveNumber(override.fontSize)
                bindNumberVariable(tn, 'fontSize', override.fontSize)
              }
              if (override && override.letterSpacing && !cs.letterSpacing) {
                tn.letterSpacing = { value: resolveNumber(override.letterSpacing), unit: 'PIXELS' }
                bindNumberVariable(tn, 'letterSpacing', override.letterSpacing)
              }
              if (cs.visible === false) tn.visible = false
              parentNode.appendChild(tn)
              if (cs.layoutGrow === 1) tn.layoutGrow = 1
            } else if (cs.type === 'ICON_INSTANCE') {
              var ic = findComponent(cs.iconName)
              if (ic) {
                var inst = ic.createInstance()
                inst.name = cs.name || cs.iconName
                if (cs.visible === false) inst.visible = false
                parentNode.appendChild(inst)
              } else {
                var ph = figma.createFrame()
                ph.name = cs.name || 'icon'
                ph.resize(cs.size || 16, cs.size || 16)
                ph.fills = []
                if (cs.visible === false) ph.visible = false
                parentNode.appendChild(ph)
              }
            } else if (cs.type === 'COMPONENT_INSTANCE') {
              var ciComp2 = findComponent(cs.componentName)
              if (ciComp2) {
                var ciInst2 = ciComp2.createInstance()
                ciInst2.name = cs.name || cs.componentName
                if (cs.visible === false) ciInst2.visible = false
                parentNode.appendChild(ciInst2)
                if (cs.layoutSizingHorizontal) ciInst2.layoutSizingHorizontal = cs.layoutSizingHorizontal as any
                if (cs.layoutSizingVertical) ciInst2.layoutSizingVertical = cs.layoutSizingVertical as any
                if (cs.overrides) {
                  var instProps2 = ciInst2.componentProperties
                  var propMap2: Record<string, string> = {}
                  for (var ipKey2 of Object.keys(instProps2)) {
                    var displayName2 = ipKey2.split('#')[0]
                    propMap2[displayName2] = ipKey2
                  }
                  var propsToSet2: Record<string, string | boolean> = {}
                  for (var ovKey2 of Object.keys(cs.overrides)) {
                    var internalKey2 = propMap2[ovKey2] || ovKey2
                    propsToSet2[internalKey2] = cs.overrides[ovKey2]
                  }
                  try {
                    ciInst2.setProperties(propsToSet2)
                  } catch (e: any) {}
                }
              } else {
                var ciPh2 = figma.createFrame()
                ciPh2.name = cs.name || 'component'
                ciPh2.resize(cs.width || 60, cs.height || 30)
                ciPh2.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }]
                parentNode.appendChild(ciPh2)
              }
            }
          }
        }

        await buildDeclChildren(comp, spec.children, combo, currentState, variantOverride)

        variants.push(comp)
        stats.variants++
      }

      // Combine into ComponentSet
      if (variants.length > 0) {
        var declCompSet = figma.combineAsVariants(variants, figma.currentPage)
        declCompSet.name = spec.name
        declCompSet.layoutMode = 'NONE'

        // Add component properties
        if (spec.componentProperties) {
          var declPropKeys: Record<string, string> = {}
          var cpEntries2 = Object.entries(spec.componentProperties)
          for (var dpi = 0; dpi < cpEntries2.length; dpi++) {
            var dpName = (cpEntries2[dpi] as any)[0] as string
            var dpDef = (cpEntries2[dpi] as any)[1] as any
            try {
              if (dpDef.type === 'TEXT') {
                declPropKeys[dpName] = declCompSet.addComponentProperty(dpName, 'TEXT', dpDef.defaultValue || '')
                debugLog.push('Created TEXT: ' + dpName)
              } else if (dpDef.type === 'BOOLEAN') {
                declPropKeys[dpName] = declCompSet.addComponentProperty(dpName, 'BOOLEAN', dpDef.defaultValue === true)
                debugLog.push('Created BOOLEAN: ' + dpName)
              }
            } catch (e: any) {
              debugLog.push('FAILED prop ' + dpName + ': ' + e.message)
            }
          }

          // Wire property references on all variants' children
          function wireDecl(node: SceneNode) {
            if ('children' in node) {
              for (var wci = 0; wci < (node as any).children.length; wci++) {
                var wChild = (node as any).children[wci] as SceneNode
                wireDecl(wChild)
              }
            }
          }

          // Simple recursive wiring by matching child names to propertyRef in spec
          function findSpecForNode(name: string, specChildren: any[]): any {
            for (var fsi = 0; fsi < specChildren.length; fsi++) {
              if (specChildren[fsi].name === name) return specChildren[fsi]
              if (specChildren[fsi].children) {
                var found = findSpecForNode(name, specChildren[fsi].children)
                if (found) return found
              }
            }
            return null
          }

          for (var wvi = 0; wvi < variants.length; wvi++) {
            function wireNode(node: SceneNode) {
              var nodeSpec = findSpecForNode(node.name, spec.children)
              if (nodeSpec && nodeSpec.propertyRef) {
                var refs: Record<string, string> = {}
                for (var rk of Object.keys(nodeSpec.propertyRef)) {
                  var rpn = nodeSpec.propertyRef[rk]
                  if (declPropKeys[rpn]) refs[rk] = declPropKeys[rpn]
                }
                if (Object.keys(refs).length > 0) {
                  (node as any).componentPropertyReferences = refs
                }
              }
              if ('children' in node) {
                for (var wnci = 0; wnci < (node as any).children.length; wnci++) {
                  wireNode((node as any).children[wnci])
                }
              }
            }
            wireNode(variants[wvi])
          }
        }

        // Layout grid
        var lastPropKey = vpKeys2[vpKeys2.length - 1]
        var colCount = spec.variantProperties[lastPropKey].length
        var dCol = 0, dRow = 0, dMaxW = 0
        for (var dvi = 0; dvi < variants.length; dvi++) {
          variants[dvi].x = dCol * 200
          variants[dvi].y = dRow * 60
          if (variants[dvi].width > dMaxW) dMaxW = variants[dvi].width
          dCol++
          if (dCol >= colCount) { dCol = 0; dRow++ }
        }
        declCompSet.resize(colCount * 200 + 40, (dRow + 1) * 60 + 40)
        declCompSet.y = componentOffsetY
        componentOffsetY += (dRow + 1) * 60 + 120
        stats.components++
      }

      stats.debug = (stats.debug || '') + debugLog.join('\n') + '\n'
      continue
    }

    // SVG-based components (selection controls, etc.)
    if (spec.renderType === 'svg' && spec.variants) {
      var debugLog: string[] = []
      debugLog.push(spec.name + ': ' + spec.variants.length + ' SVG variants')

      for (var svi = 0; svi < spec.variants.length; svi++) {
        var svgVariant = spec.variants[svi]
        try {
          var svgNode = figma.createNodeFromSvg(svgVariant.svg)
          var comp = figma.createComponent()
          comp.name = svgVariant.name
          comp.resize(svgVariant.width, svgVariant.height)
          comp.fills = []
          comp.clipsContent = false

          var svgKids = []
          for (var sk = 0; sk < svgNode.children.length; sk++) {
            svgKids.push(svgNode.children[sk])
          }
          for (var sk2 = 0; sk2 < svgKids.length; sk2++) {
            comp.appendChild(svgKids[sk2])
            try { svgKids[sk2].constraints = { horizontal: 'SCALE', vertical: 'SCALE' } } catch (e) {}
          }
          svgNode.remove()

          variants.push(comp)
          stats.variants++
        } catch (e: any) {
          debugLog.push('FAILED ' + svgVariant.name + ': ' + (e.message || String(e)))
        }
      }

      if (variants.length > 0) {
        var svgCompSet = figma.combineAsVariants(variants, figma.currentPage)
        svgCompSet.name = spec.name
        svgCompSet.layoutMode = 'NONE'

        // Layout matching live site: states across columns, other props down rows
        // Last variant prop is state → columns. Everything else → rows.
        var vpKeys = Object.keys(spec.variantProperties)
        var statesKey = vpKeys[vpKeys.length - 1]
        var statesCount = spec.variantProperties[statesKey].length

        // Calculate row count from non-state props
        var rowCount = 1
        for (var vpk = 0; vpk < vpKeys.length - 1; vpk++) {
          rowCount *= spec.variantProperties[vpKeys[vpk]].length
        }

        // Find max variant dimensions
        var maxVW = 0
        var maxVH = 0
        for (var vi3 = 0; vi3 < variants.length; vi3++) {
          if (variants[vi3].width > maxVW) maxVW = variants[vi3].width
          if (variants[vi3].height > maxVH) maxVH = variants[vi3].height
        }

        var cellW = maxVW + 32
        var cellH = maxVH + 32
        var col2 = 0
        var row2 = 0

        for (var vi4 = 0; vi4 < variants.length; vi4++) {
          // Center variant in cell
          variants[vi4].x = col2 * cellW + (cellW - variants[vi4].width) / 2
          variants[vi4].y = row2 * cellH + (cellH - variants[vi4].height) / 2
          col2++
          if (col2 >= statesCount) {
            col2 = 0
            row2++
          }
        }

        var setW = statesCount * cellW + 40
        var setH = rowCount * cellH + 40
        svgCompSet.resize(setW, setH)
        svgCompSet.y = componentOffsetY
        componentOffsetY += setH + 80
        stats.components++
        debugLog.push('Layout: ' + statesCount + ' cols x ' + rowCount + ' rows, cell ' + cellW + 'x' + cellH)
      }

      stats.debug = (stats.debug || '') + debugLog.join('\n') + '\n'
      continue
    }

    // Button-style components (existing logic)
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
