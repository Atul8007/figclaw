// figclaw — Figma Plugin Code
// Runs in Figma's plugin sandbox. Has full access to figma.* API but NO network access.
// Communicates with ui.html via figma.ui.postMessage / figma.ui.onmessage.

const CONFIG_KEY = "figclaw-config";

figma.showUI(__html__, { visible: true, width: 340, height: 260, themeColors: true });

// ── Utilities ──────────────────────────────────────────────────────────

function hexToRGB(hex) {
  const v = hex.replace("#", "").trim();
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}

function getNode(id) {
  const n = figma.getNodeById(id);
  if (!n) throw new Error("Node not found: " + id);
  return n;
}

function nodeInfo(n) {
  return { nodeId: n.id, type: n.type, name: "name" in n ? n.name : undefined };
}

function cloneArray(arr) {
  return JSON.parse(JSON.stringify(arr));
}

function getParent(parentId) {
  return parentId ? getNode(parentId) : figma.currentPage;
}

function computePageBounds() {
  const nodes = figma.currentPage.children;
  if (nodes.length === 0) return { empty: true };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    const right = n.x + ("width" in n ? n.width : 0);
    const bottom = n.y + ("height" in n ? n.height : 0);
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { minX, minY, maxX, maxY, empty: false };
}

function resolvePosition(input, parentId) {
  if (input.x !== undefined || input.y !== undefined) {
    return { x: input.x !== undefined ? input.x : 0, y: input.y !== undefined ? input.y : 0 };
  }
  if (parentId) return { x: 0, y: 0 };
  const bounds = computePageBounds();
  if (bounds.empty) return { x: 0, y: 0 };
  return { x: bounds.maxX + 100, y: bounds.minY };
}

function reply(id, result, error) {
  const msg = { replyTo: id, result };
  if (error) msg.error = error;
  figma.ui.postMessage(msg);
}

// ── Message Handler ────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  // Skip status messages from UI
  if (msg._status) return;

  // Config load/save (persists server address)
  if (msg._loadConfig) {
    const saved = await figma.clientStorage.getAsync(CONFIG_KEY);
    figma.ui.postMessage({ _config: saved || {} });
    return;
  }
  if (msg._saveConfig) {
    await figma.clientStorage.setAsync(CONFIG_KEY, msg._saveConfig);
    return;
  }

  // Design command
  const { id, action, args } = msg;
  try {
    const handler = handleAction(action, args || {});
    const result = typeof handler === "function" ? await handler() : handler;
    reply(id, { ok: true, ...result });
  } catch (e) {
    reply(id, { ok: false }, e instanceof Error ? e.message : String(e));
  }
};

// ── Action Dispatcher ──────────────────────────────────────────────────

function handleAction(action, input) {
  switch (action) {
    // Creation
    case "create_frame":        return createFrame(input);
    case "create_rectangle":    return createRectangle(input);
    case "create_ellipse":      return createEllipse(input);
    case "create_line":         return createLine(input);
    case "create_polygon":      return createPolygon(input);
    case "create_star":         return createStar(input);
    case "add_text":            return addText(input);
    case "place_image_base64":  return placeImageBase64(input);
    case "create_page":         return createPage(input);

    // Node management
    case "rename_node":         return renameNode(input);
    case "delete_node":         return deleteNode(input);
    case "duplicate_node":      return duplicateNode(input);
    case "resize_node":         return resizeNode(input);
    case "rotate_node":         return rotateNode(input);
    case "set_position":        return setPosition(input);
    case "group_nodes":         return groupNodes(input);
    case "ungroup":             return ungroupNode(input);
    case "reparent_node":       return reparentNode(input);
    case "select_nodes":        return selectNodes(input);
    case "set_properties":      return setProperties(input);

    // Styling
    case "set_fill":            return setFill(input);
    case "set_stroke":          return setStroke(input);
    case "set_corner_radius":   return setCornerRadius(input);
    case "set_opacity":         return setOpacity(input);
    case "set_blend_mode":      return setBlendMode(input);
    case "add_effect":          return addEffect(input);
    case "clear_effects":       return clearEffects(input);

    // Layout
    case "set_auto_layout":     return setAutoLayout(input);
    case "set_constraints":     return setConstraints(input);
    case "layout_grid_add":     return layoutGridAdd(input);
    case "layout_grid_clear":   return layoutGridClear(input);

    // Text
    case "set_text_content":    return setTextContent(input);
    case "set_text_style":      return setTextStyle(input);
    case "set_text_color":      return setTextColor(input);

    // Components
    case "create_component":    return createComponent(input);
    case "create_instance":     return createInstance(input);
    case "detach_instance":     return detachInstance(input);
    case "boolean_op":          return booleanOp(input);
    case "get_component_properties":  return getComponentProperties(input);
    case "set_component_properties":  return setComponentProperties(input);
    case "list_local_components":     return listLocalComponents(input);
    case "search_components":         return searchComponents(input);

    // Read
    case "find_nodes":          return findNodes(input);
    case "find_nodes_all_pages": return findNodesAllPages(input);
    case "get_selection":       return getSelection();
    case "list_pages":          return listPages();
    case "get_page_bounds":     return getPageBounds();
    case "set_current_page":    return setCurrentPage(input);
    case "get_node_deep":       return getNodeDeep(input);

    // Data & Export
    case "export_node":         return exportNode(input);
    case "set_plugin_data":     return setPluginData(input);
    case "get_plugin_data":     return getPluginData(input);

    default:
      throw new Error("Unknown action: " + action);
  }
}

// ── Creation Actions ───────────────────────────────────────────────────

function createFrame(input) {
  const { name = "Frame", width = 800, height = 600, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const f = figma.createFrame();
  f.name = name;
  f.resize(width, height);
  f.x = pos.x;
  f.y = pos.y;
  getParent(parentId).appendChild(f);
  return { nodeId: f.id, type: f.type, name: f.name, width, height, x: pos.x, y: pos.y };
}

function createRectangle(input) {
  const { width = 100, height = 100, cornerRadius, hex, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const r = figma.createRectangle();
  r.resize(width, height);
  r.x = pos.x;
  r.y = pos.y;
  if (cornerRadius !== undefined) r.cornerRadius = cornerRadius;
  if (hex) r.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
  getParent(parentId).appendChild(r);
  return { nodeId: r.id, type: r.type, x: pos.x, y: pos.y };
}

function createEllipse(input) {
  const { width = 100, height = 100, hex, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const e = figma.createEllipse();
  e.resize(width, height);
  e.x = pos.x;
  e.y = pos.y;
  if (hex) e.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
  getParent(parentId).appendChild(e);
  return { nodeId: e.id, type: e.type, x: pos.x, y: pos.y };
}

function createLine(input) {
  const { length = 100, rotation = 0, strokeHex = "000000", strokeWeight = 1, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const l = figma.createLine();
  l.resize(length, 0);
  l.rotation = rotation;
  l.x = pos.x;
  l.y = pos.y;
  l.strokes = [{ type: "SOLID", color: hexToRGB(strokeHex) }];
  l.strokeWeight = strokeWeight;
  getParent(parentId).appendChild(l);
  return { nodeId: l.id, type: l.type, x: pos.x, y: pos.y };
}

function createPolygon(input) {
  const { sides = 6, width = 100, height = 100, hex, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const p = figma.createPolygon();
  p.pointCount = sides;
  p.resize(width, height);
  p.x = pos.x;
  p.y = pos.y;
  if (hex) p.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
  getParent(parentId).appendChild(p);
  return { nodeId: p.id, type: p.type, x: pos.x, y: pos.y };
}

function createStar(input) {
  const { points = 5, width = 100, height = 100, hex, parentId } = input;
  const pos = resolvePosition(input, parentId);
  const s = figma.createStar();
  s.pointCount = points;
  s.resize(width, height);
  s.x = pos.x;
  s.y = pos.y;
  if (hex) s.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
  getParent(parentId).appendChild(s);
  return { nodeId: s.id, type: s.type, x: pos.x, y: pos.y };
}

function addText(input) {
  return async () => {
    const { text, fontFamily = "Inter", fontStyle = "Regular", fontSize = 32, hex, parentId } = input;
    const pos = resolvePosition(input, parentId);

    let family = fontFamily;
    let style = fontStyle;
    try {
      await figma.loadFontAsync({ family, style });
    } catch (e) {
      // Fallback to Inter Regular if requested font unavailable
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      family = "Inter";
      style = "Regular";
    }

    const t = figma.createText();
    t.fontName = { family, style };
    t.characters = text || "";
    if (fontSize) t.fontSize = fontSize;
    if (hex) t.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
    t.x = pos.x;
    t.y = pos.y;
    getParent(parentId).appendChild(t);
    return { nodeId: t.id, type: t.type, text: t.characters, x: pos.x, y: pos.y };
  };
}

function placeImageBase64(input) {
  return async () => {
    const { width = 200, height = 200, base64, parentId } = input;
    const pos = resolvePosition(input, parentId);

    const raw = figma.base64Decode(base64);
    const img = figma.createImage(raw);
    const r = figma.createRectangle();
    r.resize(width, height);
    r.x = pos.x;
    r.y = pos.y;
    r.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: img.hash }];
    getParent(parentId).appendChild(r);
    return { nodeId: r.id, type: r.type, x: pos.x, y: pos.y };
  };
}

function createPage(input) {
  const { name = "New Page", makeCurrent = false } = input;
  const page = figma.createPage();
  page.name = name;
  if (makeCurrent) figma.currentPage = page;
  return { pageId: page.id, name: page.name };
}

// ── Node Management Actions ────────────────────────────────────────────

function renameNode(input) {
  const n = getNode(input.nodeId);
  n.name = input.name;
  return nodeInfo(n);
}

function deleteNode(input) {
  const n = getNode(input.nodeId);
  n.remove();
  return { removed: true };
}

function duplicateNode(input) {
  const n = getNode(input.nodeId);
  const clone = n.clone();
  if (input.x !== undefined) clone.x = input.x;
  if (input.y !== undefined) clone.y = input.y;
  return nodeInfo(clone);
}

function resizeNode(input) {
  const n = getNode(input.nodeId);
  n.resize(input.width, input.height);
  return nodeInfo(n);
}

function rotateNode(input) {
  const n = getNode(input.nodeId);
  n.rotation = input.rotation;
  return nodeInfo(n);
}

function setPosition(input) {
  const n = getNode(input.nodeId);
  if (input.x !== undefined) n.x = input.x;
  if (input.y !== undefined) n.y = input.y;
  return nodeInfo(n);
}

function groupNodes(input) {
  const nodes = input.nodeIds.map((id) => getNode(id));
  const group = figma.group(nodes, figma.currentPage);
  if (input.name) group.name = input.name;
  return nodeInfo(group);
}

function ungroupNode(input) {
  const g = getNode(input.groupId);
  if (g.type !== "GROUP") throw new Error("Node is not a group");
  const parent = g.parent;
  const released = [];
  while (g.children.length > 0) {
    const child = g.children[0];
    parent.appendChild(child);
    released.push(nodeInfo(child));
  }
  g.remove();
  return { released };
}

function reparentNode(input) {
  const n = getNode(input.nodeId);
  const newParent = getNode(input.newParentId);
  if (input.index !== undefined) {
    newParent.insertChild(input.index, n);
  } else {
    newParent.appendChild(n);
  }
  return { nodeId: n.id, newParent: newParent.id };
}

function selectNodes(input) {
  const nodes = input.nodeIds.map((id) => getNode(id));
  figma.currentPage.selection = nodes;
  return { selected: nodes.map((n) => nodeInfo(n)) };
}

function setProperties(input) {
  const n = getNode(input.nodeId);
  const { nodeId, props, ...rest } = input;
  const properties = props || rest;
  for (const [key, value] of Object.entries(properties)) {
    if (key === "nodeId" || key === "props") continue;
    n[key] = value;
  }
  return nodeInfo(n);
}

// ── Styling Actions ────────────────────────────────────────────────────

function setFill(input) {
  const n = getNode(input.nodeId);
  const rgb = hexToRGB(input.hex);
  const fill = { type: "SOLID", color: rgb };
  if (input.opacity !== undefined) fill.opacity = input.opacity;
  n.fills = [fill];
  return nodeInfo(n);
}

function setStroke(input) {
  const n = getNode(input.nodeId);
  const rgb = hexToRGB(input.hex);
  const stroke = { type: "SOLID", color: rgb };
  if (input.opacity !== undefined) stroke.opacity = input.opacity;
  n.strokes = [stroke];
  if (input.strokeWeight !== undefined) n.strokeWeight = input.strokeWeight;
  if (input.strokeAlign !== undefined) n.strokeAlign = input.strokeAlign;
  if (input.dashPattern !== undefined) n.dashPattern = input.dashPattern;
  if (input.cap !== undefined) n.strokeCap = input.cap;
  if (input.join !== undefined) n.strokeJoin = input.join;
  return nodeInfo(n);
}

function setCornerRadius(input) {
  const n = getNode(input.nodeId);
  if (input.radius !== undefined) {
    n.cornerRadius = input.radius;
  }
  if (input.topLeft !== undefined || input.topRight !== undefined ||
      input.bottomRight !== undefined || input.bottomLeft !== undefined) {
    n.cornerRadius = figma.mixed;
    if (input.topLeft !== undefined) n.topLeftRadius = input.topLeft;
    if (input.topRight !== undefined) n.topRightRadius = input.topRight;
    if (input.bottomRight !== undefined) n.bottomRightRadius = input.bottomRight;
    if (input.bottomLeft !== undefined) n.bottomLeftRadius = input.bottomLeft;
  }
  return nodeInfo(n);
}

function setOpacity(input) {
  const n = getNode(input.nodeId);
  n.opacity = input.opacity;
  return nodeInfo(n);
}

function setBlendMode(input) {
  const n = getNode(input.nodeId);
  n.blendMode = input.mode;
  return nodeInfo(n);
}

function addEffect(input) {
  const { nodeId, type, radius = 8, spread = 0, hex = "#000000", opacity = 0.25, offsetX = 0, offsetY = 2 } = input;
  const n = getNode(nodeId);
  const effects = [...n.effects];

  if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
    effects.push({ type, radius, visible: true });
  } else {
    const rgb = hexToRGB(hex);
    effects.push({
      type,
      radius,
      spread,
      visible: true,
      blendMode: "NORMAL",
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: opacity },
      offset: { x: offsetX, y: offsetY },
    });
  }
  n.effects = effects;
  return nodeInfo(n);
}

function clearEffects(input) {
  const n = getNode(input.nodeId);
  n.effects = [];
  return nodeInfo(n);
}

// ── Layout Actions ─────────────────────────────────────────────────────

function setAutoLayout(input) {
  const f = getNode(input.nodeId);
  if (f.type !== "FRAME" && f.type !== "COMPONENT") throw new Error("Auto Layout requires a frame or component");
  const allowed = [
    "layoutMode", "primaryAxisSizingMode", "counterAxisSizingMode",
    "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "primaryAxisAlignItems", "counterAxisAlignItems", "layoutWrap", "counterAxisSpacing",
  ];
  for (const k of allowed) {
    if (k in input) f[k] = input[k];
  }
  return nodeInfo(f);
}

function setConstraints(input) {
  const n = getNode(input.nodeId);
  if (input.horizontal) n.constraints = { ...n.constraints, horizontal: input.horizontal };
  if (input.vertical) n.constraints = { ...n.constraints, vertical: input.vertical };
  return nodeInfo(n);
}

function layoutGridAdd(input) {
  const n = getNode(input.nodeId);
  if (n.type !== "FRAME") throw new Error("Layout grid only on frames");
  const grids = cloneArray(n.layoutGrids);
  const grid = {
    pattern: input.pattern || "COLUMNS",
    visible: true,
  };
  if (input.count !== undefined) grid.count = input.count;
  if (input.gutterSize !== undefined) grid.gutterSize = input.gutterSize;
  if (input.sectionSize !== undefined) grid.sectionSize = input.sectionSize;
  if (input.hex) {
    const rgb = hexToRGB(input.hex);
    grid.color = { r: rgb.r, g: rgb.g, b: rgb.b, a: input.opacity || 0.1 };
  }
  grids.push(grid);
  n.layoutGrids = grids;
  return nodeInfo(n);
}

function layoutGridClear(input) {
  const n = getNode(input.nodeId);
  n.layoutGrids = [];
  return nodeInfo(n);
}

// ── Text Actions ───────────────────────────────────────────────────────

function setTextContent(input) {
  return async () => {
    const n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");
    const fontName = n.fontName;
    if (typeof fontName !== "symbol") {
      await figma.loadFontAsync(fontName);
    } else {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    }
    n.characters = input.text;
    return nodeInfo(n);
  };
}

function setTextStyle(input) {
  return async () => {
    const n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");

    if (input.fontFamily || input.fontStyle) {
      const family = input.fontFamily || (typeof n.fontName !== "symbol" ? n.fontName.family : "Inter");
      const style = input.fontStyle || (typeof n.fontName !== "symbol" ? n.fontName.style : "Regular");
      await figma.loadFontAsync({ family, style });
      n.fontName = { family, style };
    } else {
      const fontName = n.fontName;
      if (typeof fontName !== "symbol") {
        await figma.loadFontAsync(fontName);
      }
    }

    if (input.fontSize !== undefined) n.fontSize = input.fontSize;
    if (input.lineHeight !== undefined) {
      n.lineHeight = typeof input.lineHeight === "number"
        ? { value: input.lineHeight, unit: "PIXELS" }
        : input.lineHeight;
    }
    if (input.letterSpacing !== undefined) {
      n.letterSpacing = typeof input.letterSpacing === "number"
        ? { value: input.letterSpacing, unit: "PIXELS" }
        : input.letterSpacing;
    }
    if (input.textAlignHorizontal) n.textAlignHorizontal = input.textAlignHorizontal;
    if (input.textAutoResize) n.textAutoResize = input.textAutoResize;

    return nodeInfo(n);
  };
}

function setTextColor(input) {
  return async () => {
    const n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");
    const rgb = hexToRGB(input.hex);
    const fill = { type: "SOLID", color: rgb };
    if (input.opacity !== undefined) fill.opacity = input.opacity;
    n.fills = [fill];
    return nodeInfo(n);
  };
}

// ── Component Actions ──────────────────────────────────────────────────

function createComponent(input) {
  const { name = "Component", fromNodeIds } = input;
  if (fromNodeIds && fromNodeIds.length > 0) {
    const nodes = fromNodeIds.map((id) => getNode(id));
    const comp = figma.createComponentFromNode(nodes[0]);
    comp.name = name;
    return nodeInfo(comp);
  }
  const comp = figma.createComponent();
  comp.name = name;
  comp.resize(100, 100);
  return nodeInfo(comp);
}

function createInstance(input) {
  const comp = getNode(input.componentId);
  if (comp.type !== "COMPONENT") throw new Error("Node is not a component");
  const inst = comp.createInstance();
  if (input.x !== undefined) inst.x = input.x;
  if (input.y !== undefined) inst.y = input.y;
  if (input.parentId) getParent(input.parentId).appendChild(inst);
  return { ...nodeInfo(inst), x: inst.x, y: inst.y };
}

function detachInstance(input) {
  const n = getNode(input.nodeId);
  if (n.type !== "INSTANCE") throw new Error("Node is not an instance");
  const detached = n.detachInstance();
  return nodeInfo(detached);
}

function booleanOp(input) {
  const { op, nodeIds, name } = input;
  const nodes = nodeIds.map((id) => getNode(id));
  const ops = { UNION: "UNION", SUBTRACT: "SUBTRACT", INTERSECT: "INTERSECT", EXCLUDE: "EXCLUDE" };
  if (!ops[op]) throw new Error("Invalid boolean op: " + op);
  const result = figma.union(nodes, figma.currentPage);
  if (op !== "UNION") {
    result.booleanOperation = op;
  }
  if (name) result.name = name;
  return nodeInfo(result);
}

function getComponentProperties(input) {
  const n = getNode(input.nodeId);
  const properties = {};
  if ("componentProperties" in n) {
    for (const [key, val] of Object.entries(n.componentProperties)) {
      properties[key] = { type: val.type, value: val.value };
    }
  }
  return { ...nodeInfo(n), properties };
}

function setComponentProperties(input) {
  const n = getNode(input.nodeId);
  if (!("setProperties" in n)) throw new Error("Node does not support setProperties");
  const updated = {};
  for (const [key, value] of Object.entries(input.properties)) {
    n.setProperties({ [key]: value });
    updated[key] = value;
  }
  return { nodeId: n.id, name: n.name, updated };
}

function listLocalComponents(input) {
  const { pageFilter, limit = 100 } = input || {};
  const components = [];
  const pages = pageFilter
    ? figma.root.children.filter((p) => p.name === pageFilter)
    : figma.root.children;

  for (const page of pages) {
    const found = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (const c of found) {
      if (components.length >= limit) break;
      components.push({ nodeId: c.id, name: c.name, page: page.name });
    }
    if (components.length >= limit) break;
  }
  return { count: components.length, components };
}

function searchComponents(input) {
  const { query, limit = 20 } = input;
  const q = query.toLowerCase();
  const components = [];
  for (const page of figma.root.children) {
    const found = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (const c of found) {
      if (c.name.toLowerCase().includes(q)) {
        components.push({ nodeId: c.id, name: c.name, page: page.name });
        if (components.length >= limit) break;
      }
    }
    if (components.length >= limit) break;
  }
  return { query, count: components.length, components };
}

// ── Read Actions ───────────────────────────────────────────────────────

function findNodes(input) {
  const { name, type } = input;
  let results = [];
  if (name) {
    results = figma.currentPage.findAll((n) => n.name === name);
  } else if (type) {
    results = figma.currentPage.findAllWithCriteria({ types: [type] });
  } else {
    results = figma.currentPage.children;
  }
  return { count: results.length, nodes: results.slice(0, 100).map((n) => nodeInfo(n)) };
}

function findNodesAllPages(input) {
  const { name, type } = input;
  const results = [];
  for (const page of figma.root.children) {
    let found;
    if (name) {
      found = page.findAll((n) => n.name === name);
    } else if (type) {
      found = page.findAllWithCriteria({ types: [type] });
    } else {
      found = page.children;
    }
    for (const n of found) {
      results.push({ ...nodeInfo(n), page: page.name });
      if (results.length >= 100) break;
    }
    if (results.length >= 100) break;
  }
  return { count: results.length, nodes: results };
}

function getSelection() {
  return figma.currentPage.selection.map((n) => nodeInfo(n));
}

function listPages() {
  return {
    pages: figma.root.children.map((p) => ({ pageId: p.id, name: p.name })),
    currentPage: { pageId: figma.currentPage.id, name: figma.currentPage.name },
  };
}

function setCurrentPage(input) {
  const page = getNode(input.pageId);
  if (page.type !== "PAGE") throw new Error("Node is not a page");
  figma.currentPage = page;
  return { pageId: page.id, name: page.name };
}

function getPageBounds() {
  const bounds = computePageBounds();
  const topLevelNodes = figma.currentPage.children.map((n) => ({
    ...nodeInfo(n),
    x: n.x,
    y: n.y,
    width: "width" in n ? n.width : 0,
    height: "height" in n ? n.height : 0,
  }));
  const suggested = bounds.empty
    ? { x: 0, y: 0 }
    : { x: bounds.maxX + 100, y: bounds.minY };
  return { bounds, suggestedNextPosition: suggested, topLevelNodes };
}

function getNodeDeep(input) {
  const { nodeId, depth = 2 } = input;
  const n = getNode(nodeId);
  return serializeNode(n, depth);
}

function serializeNode(n, depth) {
  const info = {
    nodeId: n.id,
    type: n.type,
    name: "name" in n ? n.name : undefined,
    x: n.x,
    y: n.y,
    width: "width" in n ? n.width : undefined,
    height: "height" in n ? n.height : undefined,
    opacity: n.opacity,
    visible: n.visible,
  };
  if ("fills" in n && n.fills !== figma.mixed) info.fills = cloneArray(n.fills);
  if ("strokes" in n) info.strokes = cloneArray(n.strokes);
  if ("effects" in n) info.effects = cloneArray(n.effects);
  if ("cornerRadius" in n) info.cornerRadius = n.cornerRadius;
  if ("characters" in n) info.characters = n.characters;
  if ("fontSize" in n && typeof n.fontSize !== "symbol") info.fontSize = n.fontSize;
  if ("fontName" in n && typeof n.fontName !== "symbol") info.fontName = n.fontName;
  if ("layoutMode" in n) info.layoutMode = n.layoutMode;
  if ("itemSpacing" in n) info.itemSpacing = n.itemSpacing;
  if (depth > 0 && "children" in n) {
    info.children = n.children.map((c) => serializeNode(c, depth - 1));
  }
  return info;
}

// ── Data & Export Actions ──────────────────────────────────────────────

function exportNode(input) {
  return async () => {
    const n = getNode(input.nodeId);
    const format = (input.format || "PNG").toUpperCase();
    const settings = { format };
    if (input.scale) settings.constraint = { type: "SCALE", value: input.scale };
    const bytes = await n.exportAsync(settings);
    const base64 = figma.base64Encode(bytes);
    return { format, base64 };
  };
}

function setPluginData(input) {
  const n = getNode(input.nodeId);
  n.setPluginData(input.key, input.value);
  return { nodeId: n.id };
}

function getPluginData(input) {
  const n = getNode(input.nodeId);
  return { value: n.getPluginData(input.key) };
}
