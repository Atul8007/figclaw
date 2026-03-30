// figclaw — Figma Plugin Code
// Runs in Figma's plugin sandbox. Has full access to figma.* API but NO network access.
// Communicates with ui.html via figma.ui.postMessage / figma.ui.onmessage.
// NOTE: Figma's JS sandbox does NOT support: ?? (nullish coalescing), ?. (optional chaining), or ... (spread).
// Use Object.assign() and Array.concat() instead.

var CONFIG_KEY = "figclaw-config";

figma.showUI(__html__, { visible: true, width: 340, height: 260, themeColors: true });

// ── Utilities ──────────────────────────────────────────────────────────

function hexToRGB(hex) {
  var v = hex.replace("#", "").trim();
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255
  };
}

function getNode(id) {
  var n = figma.getNodeById(id);
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
  var nodes = figma.currentPage.children;
  if (nodes.length === 0) return { empty: true };
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    var right = n.x + ("width" in n ? n.width : 0);
    var bottom = n.y + ("height" in n ? n.height : 0);
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, empty: false };
}

function resolvePosition(input, parentId) {
  if (input.x !== undefined || input.y !== undefined) {
    return { x: input.x !== undefined ? input.x : 0, y: input.y !== undefined ? input.y : 0 };
  }
  if (parentId) return { x: 0, y: 0 };
  var bounds = computePageBounds();
  if (bounds.empty) return { x: 0, y: 0 };
  return { x: bounds.maxX + 100, y: bounds.minY };
}

function reply(id, result, error) {
  var msg = { replyTo: id, result: result };
  if (error) msg.error = error;
  figma.ui.postMessage(msg);
}

// ── Message Handler ────────────────────────────────────────────────────

figma.ui.onmessage = async function (msg) {
  // Skip status messages from UI
  if (msg._status) return;

  // Config load/save (persists server address)
  if (msg._loadConfig) {
    var saved = await figma.clientStorage.getAsync(CONFIG_KEY);
    figma.ui.postMessage({ _config: saved || {} });
    return;
  }
  if (msg._saveConfig) {
    await figma.clientStorage.setAsync(CONFIG_KEY, msg._saveConfig);
    return;
  }

  // Design command
  var id = msg.id;
  var action = msg.action;
  var args = msg.args || {};
  try {
    var handler = handleAction(action, args);
    var result = typeof handler === "function" ? await handler() : handler;
    var response = Object.assign({ ok: true }, result);
    reply(id, response);
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
  var name = input.name || "Frame";
  var width = input.width || 800;
  var height = input.height || 600;
  var parentId = input.parentId;
  var pos = resolvePosition(input, parentId);
  var f = figma.createFrame();
  f.name = name;
  f.resize(width, height);
  f.x = pos.x;
  f.y = pos.y;
  getParent(parentId).appendChild(f);
  return { nodeId: f.id, type: f.type, name: f.name, width: width, height: height, x: pos.x, y: pos.y };
}

function createRectangle(input) {
  var width = input.width || 100;
  var height = input.height || 100;
  var pos = resolvePosition(input, input.parentId);
  var r = figma.createRectangle();
  r.resize(width, height);
  r.x = pos.x;
  r.y = pos.y;
  if (input.cornerRadius !== undefined) r.cornerRadius = input.cornerRadius;
  if (input.hex) r.fills = [{ type: "SOLID", color: hexToRGB(input.hex) }];
  getParent(input.parentId).appendChild(r);
  return { nodeId: r.id, type: r.type, x: pos.x, y: pos.y };
}

function createEllipse(input) {
  var width = input.width || 100;
  var height = input.height || 100;
  var pos = resolvePosition(input, input.parentId);
  var e = figma.createEllipse();
  e.resize(width, height);
  e.x = pos.x;
  e.y = pos.y;
  if (input.hex) e.fills = [{ type: "SOLID", color: hexToRGB(input.hex) }];
  getParent(input.parentId).appendChild(e);
  return { nodeId: e.id, type: e.type, x: pos.x, y: pos.y };
}

function createLine(input) {
  var length = input.length || 100;
  var rotation = input.rotation || 0;
  var strokeHex = input.strokeHex || "000000";
  var strokeWeight = input.strokeWeight || 1;
  var pos = resolvePosition(input, input.parentId);
  var l = figma.createLine();
  l.resize(length, 0);
  l.rotation = rotation;
  l.x = pos.x;
  l.y = pos.y;
  l.strokes = [{ type: "SOLID", color: hexToRGB(strokeHex) }];
  l.strokeWeight = strokeWeight;
  getParent(input.parentId).appendChild(l);
  return { nodeId: l.id, type: l.type, x: pos.x, y: pos.y };
}

function createPolygon(input) {
  var sides = input.sides || 6;
  var width = input.width || 100;
  var height = input.height || 100;
  var pos = resolvePosition(input, input.parentId);
  var p = figma.createPolygon();
  p.pointCount = sides;
  p.resize(width, height);
  p.x = pos.x;
  p.y = pos.y;
  if (input.hex) p.fills = [{ type: "SOLID", color: hexToRGB(input.hex) }];
  getParent(input.parentId).appendChild(p);
  return { nodeId: p.id, type: p.type, x: pos.x, y: pos.y };
}

function createStar(input) {
  var points = input.points || 5;
  var width = input.width || 100;
  var height = input.height || 100;
  var pos = resolvePosition(input, input.parentId);
  var s = figma.createStar();
  s.pointCount = points;
  s.resize(width, height);
  s.x = pos.x;
  s.y = pos.y;
  if (input.hex) s.fills = [{ type: "SOLID", color: hexToRGB(input.hex) }];
  getParent(input.parentId).appendChild(s);
  return { nodeId: s.id, type: s.type, x: pos.x, y: pos.y };
}

function addText(input) {
  return async function () {
    var text = input.text;
    var fontFamily = input.fontFamily || "Inter";
    var fontStyle = input.fontStyle || "Regular";
    var fontSize = input.fontSize || 32;
    var hex = input.hex;
    var parentId = input.parentId;
    var pos = resolvePosition(input, parentId);

    var family = fontFamily;
    var style = fontStyle;
    try {
      await figma.loadFontAsync({ family: family, style: style });
    } catch (e) {
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      family = "Inter";
      style = "Regular";
    }

    var t = figma.createText();
    t.fontName = { family: family, style: style };
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
  return async function () {
    var width = input.width || 200;
    var height = input.height || 200;
    var base64 = input.base64;
    var parentId = input.parentId;
    var pos = resolvePosition(input, parentId);

    var raw = figma.base64Decode(base64);
    var img = figma.createImage(raw);
    var r = figma.createRectangle();
    r.resize(width, height);
    r.x = pos.x;
    r.y = pos.y;
    r.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: img.hash }];
    getParent(parentId).appendChild(r);
    return { nodeId: r.id, type: r.type, x: pos.x, y: pos.y };
  };
}

function createPage(input) {
  var name = input.name || "New Page";
  var makeCurrent = input.makeCurrent || false;
  var page = figma.createPage();
  page.name = name;
  if (makeCurrent) figma.currentPage = page;
  return { pageId: page.id, name: page.name };
}

// ── Node Management Actions ────────────────────────────────────────────

function renameNode(input) {
  var n = getNode(input.nodeId);
  n.name = input.name;
  return nodeInfo(n);
}

function deleteNode(input) {
  var n = getNode(input.nodeId);
  n.remove();
  return { removed: true };
}

function duplicateNode(input) {
  var n = getNode(input.nodeId);
  var clone = n.clone();
  if (input.x !== undefined) clone.x = input.x;
  if (input.y !== undefined) clone.y = input.y;
  return nodeInfo(clone);
}

function resizeNode(input) {
  var n = getNode(input.nodeId);
  n.resize(input.width, input.height);
  return nodeInfo(n);
}

function rotateNode(input) {
  var n = getNode(input.nodeId);
  n.rotation = input.rotation;
  return nodeInfo(n);
}

function setPosition(input) {
  var n = getNode(input.nodeId);
  if (input.x !== undefined) n.x = input.x;
  if (input.y !== undefined) n.y = input.y;
  return nodeInfo(n);
}

function groupNodes(input) {
  var nodes = input.nodeIds.map(function (id) { return getNode(id); });
  var group = figma.group(nodes, figma.currentPage);
  if (input.name) group.name = input.name;
  return nodeInfo(group);
}

function ungroupNode(input) {
  var g = getNode(input.groupId);
  if (g.type !== "GROUP") throw new Error("Node is not a group");
  var parent = g.parent;
  var released = [];
  while (g.children.length > 0) {
    var child = g.children[0];
    parent.appendChild(child);
    released.push(nodeInfo(child));
  }
  g.remove();
  return { released: released };
}

function reparentNode(input) {
  var n = getNode(input.nodeId);
  var newParent = getNode(input.newParentId);
  if (input.index !== undefined) {
    newParent.insertChild(input.index, n);
  } else {
    newParent.appendChild(n);
  }
  return { nodeId: n.id, newParent: newParent.id };
}

function selectNodes(input) {
  var nodes = input.nodeIds.map(function (id) { return getNode(id); });
  figma.currentPage.selection = nodes;
  return { selected: nodes.map(function (n) { return nodeInfo(n); }) };
}

function setProperties(input) {
  var n = getNode(input.nodeId);
  var properties = input.props || input;
  var keys = Object.keys(properties);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key === "nodeId" || key === "props") continue;
    n[key] = properties[key];
  }
  return nodeInfo(n);
}

// ── Styling Actions ────────────────────────────────────────────────────

function setFill(input) {
  var n = getNode(input.nodeId);
  var rgb = hexToRGB(input.hex);
  var fill = { type: "SOLID", color: rgb };
  if (input.opacity !== undefined) fill.opacity = input.opacity;
  n.fills = [fill];
  return nodeInfo(n);
}

function setStroke(input) {
  var n = getNode(input.nodeId);
  var rgb = hexToRGB(input.hex);
  var stroke = { type: "SOLID", color: rgb };
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
  var n = getNode(input.nodeId);
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
  var n = getNode(input.nodeId);
  n.opacity = input.opacity;
  return nodeInfo(n);
}

function setBlendMode(input) {
  var n = getNode(input.nodeId);
  n.blendMode = input.mode;
  return nodeInfo(n);
}

function addEffect(input) {
  var nodeId = input.nodeId;
  var type = input.type;
  var radius = input.radius !== undefined ? input.radius : 8;
  var spread = input.spread !== undefined ? input.spread : 0;
  var hex = input.hex || "#000000";
  var opacity = input.opacity !== undefined ? input.opacity : 0.25;
  var offsetX = input.offsetX || 0;
  var offsetY = input.offsetY !== undefined ? input.offsetY : 2;

  var n = getNode(nodeId);
  var effects = cloneArray(n.effects);

  if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
    effects.push({ type: type, radius: radius, visible: true });
  } else {
    var rgb = hexToRGB(hex);
    effects.push({
      type: type,
      radius: radius,
      spread: spread,
      visible: true,
      blendMode: "NORMAL",
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: opacity },
      offset: { x: offsetX, y: offsetY }
    });
  }
  n.effects = effects;
  return nodeInfo(n);
}

function clearEffects(input) {
  var n = getNode(input.nodeId);
  n.effects = [];
  return nodeInfo(n);
}

// ── Layout Actions ─────────────────────────────────────────────────────

function setAutoLayout(input) {
  var f = getNode(input.nodeId);
  if (f.type !== "FRAME" && f.type !== "COMPONENT") throw new Error("Auto Layout requires a frame or component");
  var allowed = [
    "layoutMode", "primaryAxisSizingMode", "counterAxisSizingMode",
    "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "primaryAxisAlignItems", "counterAxisAlignItems", "layoutWrap", "counterAxisSpacing"
  ];
  for (var i = 0; i < allowed.length; i++) {
    var k = allowed[i];
    if (k in input) f[k] = input[k];
  }
  return nodeInfo(f);
}

function setConstraints(input) {
  var n = getNode(input.nodeId);
  var c = JSON.parse(JSON.stringify(n.constraints));
  if (input.horizontal) c.horizontal = input.horizontal;
  if (input.vertical) c.vertical = input.vertical;
  n.constraints = c;
  return nodeInfo(n);
}

function layoutGridAdd(input) {
  var n = getNode(input.nodeId);
  if (n.type !== "FRAME") throw new Error("Layout grid only on frames");
  var grids = cloneArray(n.layoutGrids);
  var grid = {
    pattern: input.pattern || "COLUMNS",
    visible: true
  };
  if (input.count !== undefined) grid.count = input.count;
  if (input.gutterSize !== undefined) grid.gutterSize = input.gutterSize;
  if (input.sectionSize !== undefined) grid.sectionSize = input.sectionSize;
  if (input.hex) {
    var rgb = hexToRGB(input.hex);
    grid.color = { r: rgb.r, g: rgb.g, b: rgb.b, a: input.opacity || 0.1 };
  }
  grids.push(grid);
  n.layoutGrids = grids;
  return nodeInfo(n);
}

function layoutGridClear(input) {
  var n = getNode(input.nodeId);
  n.layoutGrids = [];
  return nodeInfo(n);
}

// ── Text Actions ───────────────────────────────────────────────────────

function setTextContent(input) {
  return async function () {
    var n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");
    var fontName = n.fontName;
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
  return async function () {
    var n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");

    if (input.fontFamily || input.fontStyle) {
      var family = input.fontFamily || (typeof n.fontName !== "symbol" ? n.fontName.family : "Inter");
      var style = input.fontStyle || (typeof n.fontName !== "symbol" ? n.fontName.style : "Regular");
      await figma.loadFontAsync({ family: family, style: style });
      n.fontName = { family: family, style: style };
    } else {
      var fontName = n.fontName;
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
  return async function () {
    var n = getNode(input.nodeId);
    if (n.type !== "TEXT") throw new Error("Node is not a text node");
    var rgb = hexToRGB(input.hex);
    var fill = { type: "SOLID", color: rgb };
    if (input.opacity !== undefined) fill.opacity = input.opacity;
    n.fills = [fill];
    return nodeInfo(n);
  };
}

// ── Component Actions ──────────────────────────────────────────────────

function createComponent(input) {
  var name = input.name || "Component";
  var fromNodeIds = input.fromNodeIds;
  if (fromNodeIds && fromNodeIds.length > 0) {
    var nodes = fromNodeIds.map(function (id) { return getNode(id); });
    var comp = figma.createComponentFromNode(nodes[0]);
    comp.name = name;
    return nodeInfo(comp);
  }
  var comp = figma.createComponent();
  comp.name = name;
  comp.resize(100, 100);
  return nodeInfo(comp);
}

function createInstance(input) {
  var comp = getNode(input.componentId);
  if (comp.type !== "COMPONENT") throw new Error("Node is not a component");
  var inst = comp.createInstance();
  if (input.x !== undefined) inst.x = input.x;
  if (input.y !== undefined) inst.y = input.y;
  if (input.parentId) getParent(input.parentId).appendChild(inst);
  var info = nodeInfo(inst);
  info.x = inst.x;
  info.y = inst.y;
  return info;
}

function detachInstance(input) {
  var n = getNode(input.nodeId);
  if (n.type !== "INSTANCE") throw new Error("Node is not an instance");
  var detached = n.detachInstance();
  return nodeInfo(detached);
}

function booleanOp(input) {
  var op = input.op;
  var nodeIds = input.nodeIds;
  var name = input.name;
  var nodes = nodeIds.map(function (id) { return getNode(id); });
  var ops = { UNION: "UNION", SUBTRACT: "SUBTRACT", INTERSECT: "INTERSECT", EXCLUDE: "EXCLUDE" };
  if (!ops[op]) throw new Error("Invalid boolean op: " + op);
  var result = figma.union(nodes, figma.currentPage);
  if (op !== "UNION") {
    result.booleanOperation = op;
  }
  if (name) result.name = name;
  return nodeInfo(result);
}

function getComponentProperties(input) {
  var n = getNode(input.nodeId);
  var properties = {};
  if ("componentProperties" in n) {
    var entries = Object.keys(n.componentProperties);
    for (var i = 0; i < entries.length; i++) {
      var key = entries[i];
      var val = n.componentProperties[key];
      properties[key] = { type: val.type, value: val.value };
    }
  }
  var info = nodeInfo(n);
  info.properties = properties;
  return info;
}

function setComponentProperties(input) {
  var n = getNode(input.nodeId);
  if (!("setProperties" in n)) throw new Error("Node does not support setProperties");
  var updated = {};
  var keys = Object.keys(input.properties);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var obj = {};
    obj[key] = input.properties[key];
    n.setProperties(obj);
    updated[key] = input.properties[key];
  }
  return { nodeId: n.id, name: n.name, updated: updated };
}

function listLocalComponents(input) {
  var pageFilter = input ? input.pageFilter : undefined;
  var limit = (input && input.limit) || 100;
  var components = [];
  var pages = pageFilter
    ? figma.root.children.filter(function (p) { return p.name === pageFilter; })
    : figma.root.children;

  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var found = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (var j = 0; j < found.length; j++) {
      if (components.length >= limit) break;
      components.push({ nodeId: found[j].id, name: found[j].name, page: page.name });
    }
    if (components.length >= limit) break;
  }
  return { count: components.length, components: components };
}

function searchComponents(input) {
  var query = input.query;
  var limit = input.limit || 20;
  var q = query.toLowerCase();
  var components = [];
  var pages = figma.root.children;
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var found = page.findAllWithCriteria({ types: ["COMPONENT"] });
    for (var j = 0; j < found.length; j++) {
      if (found[j].name.toLowerCase().indexOf(q) !== -1) {
        components.push({ nodeId: found[j].id, name: found[j].name, page: page.name });
        if (components.length >= limit) break;
      }
    }
    if (components.length >= limit) break;
  }
  return { query: query, count: components.length, components: components };
}

// ── Read Actions ───────────────────────────────────────────────────────

function findNodes(input) {
  var name = input.name;
  var type = input.type;
  var results = [];
  if (name) {
    results = figma.currentPage.findAll(function (n) { return n.name === name; });
  } else if (type) {
    results = figma.currentPage.findAllWithCriteria({ types: [type] });
  } else {
    results = figma.currentPage.children;
  }
  return { count: results.length, nodes: results.slice(0, 100).map(function (n) { return nodeInfo(n); }) };
}

function findNodesAllPages(input) {
  var name = input.name;
  var type = input.type;
  var results = [];
  var pages = figma.root.children;
  for (var i = 0; i < pages.length; i++) {
    var page = pages[i];
    var found;
    if (name) {
      found = page.findAll(function (n) { return n.name === name; });
    } else if (type) {
      found = page.findAllWithCriteria({ types: [type] });
    } else {
      found = page.children;
    }
    for (var j = 0; j < found.length; j++) {
      var info = nodeInfo(found[j]);
      info.page = page.name;
      results.push(info);
      if (results.length >= 100) break;
    }
    if (results.length >= 100) break;
  }
  return { count: results.length, nodes: results };
}

function getSelection() {
  return figma.currentPage.selection.map(function (n) { return nodeInfo(n); });
}

function listPages() {
  return {
    pages: figma.root.children.map(function (p) { return { pageId: p.id, name: p.name }; }),
    currentPage: { pageId: figma.currentPage.id, name: figma.currentPage.name }
  };
}

function setCurrentPage(input) {
  var page = getNode(input.pageId);
  if (page.type !== "PAGE") throw new Error("Node is not a page");
  figma.currentPage = page;
  return { pageId: page.id, name: page.name };
}

function getPageBounds() {
  var bounds = computePageBounds();
  var topLevelNodes = figma.currentPage.children.map(function (n) {
    var info = nodeInfo(n);
    info.x = n.x;
    info.y = n.y;
    info.width = "width" in n ? n.width : 0;
    info.height = "height" in n ? n.height : 0;
    return info;
  });
  var suggested = bounds.empty
    ? { x: 0, y: 0 }
    : { x: bounds.maxX + 100, y: bounds.minY };
  return { bounds: bounds, suggestedNextPosition: suggested, topLevelNodes: topLevelNodes };
}

function getNodeDeep(input) {
  var nodeId = input.nodeId;
  var depth = input.depth !== undefined ? input.depth : 2;
  var n = getNode(nodeId);
  return serializeNode(n, depth);
}

function serializeNode(n, depth) {
  var info = {
    nodeId: n.id,
    type: n.type,
    name: "name" in n ? n.name : undefined,
    x: n.x,
    y: n.y,
    width: "width" in n ? n.width : undefined,
    height: "height" in n ? n.height : undefined,
    opacity: n.opacity,
    visible: n.visible
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
    info.children = n.children.map(function (c) { return serializeNode(c, depth - 1); });
  }
  return info;
}

// ── Data & Export Actions ──────────────────────────────────────────────

function exportNode(input) {
  return async function () {
    var n = getNode(input.nodeId);
    var format = (input.format || "PNG").toUpperCase();
    var settings = { format: format };
    if (input.scale) settings.constraint = { type: "SCALE", value: input.scale };
    var bytes = await n.exportAsync(settings);
    var base64 = figma.base64Encode(bytes);
    return { format: format, base64: base64 };
  };
}

function setPluginData(input) {
  var n = getNode(input.nodeId);
  n.setPluginData(input.key, input.value);
  return { nodeId: n.id };
}

function getPluginData(input) {
  var n = getNode(input.nodeId);
  return { value: n.getPluginData(input.key) };
}
