# figclaw Plugin Documentation

> figclaw is a WebSocket-based Figma plugin that lets AI agents (Claude Code, Cursor, etc.) create and modify Figma designs programmatically. Built and battle-tested during the WAC homepage revamp project.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How It Works](#how-it-works)
3. [Project Structure](#project-structure)
4. [Plugin Code Deep Dive](#plugin-code-deep-dive)
5. [UI Layer Deep Dive](#ui-layer-deep-dive)
6. [Build Script Deep Dive](#build-script-deep-dive)
7. [Complete Action Reference](#complete-action-reference)
8. [Message Protocol](#message-protocol)
9. [Known Limitations & Workarounds](#known-limitations--workarounds)
10. [Lessons Learned](#lessons-learned)
11. [Building Your Own Plugin](#building-your-own-plugin)
12. [Comparison with Pencil MCP](#comparison-with-pencil-mcp)

---

## Architecture Overview

```
┌──────────────────┐     stdio/terminal    ┌──────────────────┐
│                  │                        │                  │
│  AI Agent        │  (triggers script)     │  Node.js         │
│  (Claude Code)   │ ─────────────────────► │  Build Script    │
│                  │                        │                  │
└──────────────────┘                        └────────┬─────────┘
                                                     │
                                              WebSocket Server
                                              ws://127.0.0.1:3066
                                                     │
                                            ┌────────▼─────────┐
                                            │                  │
                                            │  Figma Plugin    │
                                            │  (ui.html)       │
                                            │                  │
                                            │  ┌────────────┐  │
                                            │  │ plugin.js  │  │
                                            │  │ (sandbox)  │  │
                                            │  └────────────┘  │
                                            │                  │
                                            └────────┬─────────┘
                                                     │
                                              Figma Plugin API
                                              figma.createFrame()
                                              figma.createText()
                                              etc.
                                                     │
                                            ┌────────▼─────────┐
                                            │                  │
                                            │  Figma Canvas    │
                                            │  (Design File)   │
                                            │                  │
                                            └──────────────────┘
```

The system has **three layers**:

| Layer | Runtime | Network Access | Figma API Access |
|-------|---------|---------------|-----------------|
| **Build Script** (`build-figma-design.js`) | Node.js process on your machine | Full (creates WebSocket server) | None |
| **Plugin UI** (`ui.html`) | Figma's iframe sandbox | Yes (WebSocket client, fetch) | None (communicates via `postMessage`) |
| **Plugin Code** (`plugin.js`) | Figma's plugin sandbox | None (no network) | Full (`figma.*` API) |

**Why three layers?** Figma's security model:
- Plugin code (`plugin.js`) can access `figma.*` API but has NO network access
- Plugin UI (`ui.html`) can access the network but has NO `figma.*` API access
- They communicate via `figma.ui.postMessage()` / `figma.ui.onmessage`
- The UI bridges between the WebSocket server (network) and plugin code (Figma API)

---

## How It Works

### Step-by-step message flow

```
1. Build script starts WebSocket server on port 3066
2. User opens Figma, runs the plugin, enters 127.0.0.1:3066, clicks Connect
3. Plugin UI connects as WebSocket client
4. Build script sends: {"id": 1, "action": "create_frame", "args": {"name": "Hero", "width": 1440, "height": 900}}
5. Plugin UI receives WebSocket message, forwards via parent.postMessage({pluginMessage: msg})
6. Plugin code receives via figma.ui.onmessage, dispatches to handleAction("create_frame", args)
7. Plugin code calls figma.createFrame(), sets properties, returns {nodeId: "11:3", ...}
8. Plugin code sends reply via figma.ui.postMessage({replyTo: 1, result: {...}})
9. Plugin UI receives postMessage, forwards via ws.send(JSON.stringify(msg))
10. Build script receives reply, resolves the pending Promise for id:1
```

### Connection lifecycle

```
Build Script                Plugin UI                  Plugin Code
    │                          │                            │
    │ [Start WS Server]        │                            │
    │ ◄─── [User clicks        │                            │
    │       Connect] ──────────│                            │
    │                          │ ws = new WebSocket(url)    │
    │ ◄──── onopen ────────────│                            │
    │                          │ sends {hello:"from-plugin"}│
    │                          │                            │
    │ ──── {id,action,args} ──►│                            │
    │                          │ ── postMessage(msg) ──────►│
    │                          │                            │ handleAction()
    │                          │                            │ figma.create*()
    │                          │ ◄── postMessage(reply) ────│
    │ ◄──── {replyTo,result} ──│                            │
    │                          │                            │
    │ [disconnect]             │                            │
    │                          │ auto-reconnect in 3s       │
    │                          │                            │
```

---

## Project Structure

```
figclaw/
├── manifest.json          # Figma plugin manifest
├── plugin.js              # Compiled plugin code (runs in Figma sandbox)
├── ui.html                # Plugin UI (WebSocket bridge)
└── src/
    └── plugin.ts          # TypeScript source (if building from source)

build-figma-design.js      # Node.js build script (WebSocket server + design commands)
```

### manifest.json

```json
{
  "name": "figclaw",
  "id": "figclaw-figma-bridge",
  "api": "1.0.0",
  "main": "plugin.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["*"],
    "reasoning": "Connects to local server to receive design commands from AI agents."
  }
}
```

Key fields:
- `"main": "plugin.js"` — the code that runs in Figma's plugin sandbox
- `"ui": "ui.html"` — the UI that runs in Figma's iframe sandbox
- `"networkAccess": {"allowedDomains": ["*"]}` — required for WebSocket connections
- `"editorType": ["figma"]` — works in Figma design files (not FigJam)

---

## Plugin Code Deep Dive

### Entry Point

```typescript
// plugin.js line 43
figma.showUI(__html__, { visible: true, width: 320, height: 240, themeColors: true });
```

Shows the UI iframe. `__html__` is the contents of `ui.html` injected by Figma's build system.

### Message Handler

```typescript
// plugin.js lines 45-63
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
    const result = await handleAction(action, args || {});
    reply(id, { ok: true, ...result });
  } catch (e) {
    reply(id, { ok: false }, e instanceof Error ? e.message : String(e));
  }
};
```

### Action Dispatcher

The `handleAction` function is a switch statement mapping 42 action names to handler functions:

```typescript
// plugin.js lines 129-238
function handleAction(action, input) {
  switch (action) {
    case "create_frame":       return createFrame(input);
    case "create_rectangle":   return createRectangle(input);
    case "create_ellipse":     return createEllipse(input);
    case "create_line":        return createLine(input);
    case "create_polygon":     return createPolygon(input);
    case "create_star":        return createStar(input);
    case "add_text":           return addText(input);
    case "place_image_base64": return placeImageBase64(input);
    case "find_nodes":         return findNodes(input);
    case "select_nodes":       return selectNodes(input);
    case "get_selection":      return getSelection();
    case "create_page":        return createPage(input);
    case "set_current_page":   return setCurrentPage(input);
    case "rename_node":        return renameNode(input);
    case "delete_node":        return deleteNode(input);
    case "duplicate_node":     return duplicateNode(input);
    case "resize_node":        return resizeNode(input);
    case "rotate_node":        return rotateNode(input);
    case "set_position":       return setPosition(input);
    case "group_nodes":        return groupNodes(input);
    case "ungroup":            return ungroupNode(input);
    case "set_fill":           return setFill(input);
    case "set_stroke":         return setStroke(input);
    case "set_corner_radius":  return setCornerRadius(input);
    case "set_opacity":        return setOpacity(input);
    case "set_blend_mode":     return setBlendMode(input);
    case "add_effect":         return addEffect(input);
    case "clear_effects":      return clearEffects(input);
    case "layout_grid_add":    return layoutGridAdd(input);
    case "layout_grid_clear":  return layoutGridClear(input);
    case "set_auto_layout":    return setAutoLayout(input);
    case "set_constraints":    return setConstraints(input);
    case "set_text_content":   return setTextContent(input);
    case "set_text_style":     return setTextStyle(input);
    case "set_text_color":     return setTextColor(input);
    case "create_component":   return createComponent(input);
    case "create_instance":    return createInstance(input);
    case "detach_instance":    return detachInstance(input);
    case "boolean_op":         return booleanOp(input);
    case "export_node":        return exportNode(input);
    case "set_plugin_data":    return setPluginData(input);
    case "get_plugin_data":    return getPluginData(input);
    case "set_properties":     return setProperties(input);
    case "reparent_node":      return reparentNode(input);
    case "get_component_properties":  return getComponentProperties(input);
    case "set_component_properties":  return setComponentProperties(input);
    case "list_local_components":     return listLocalComponents(input);
    case "search_components":         return searchComponents(input);
    case "list_pages":                return listPages();
    case "find_nodes_all_pages":      return findNodesAllPages(input);
    case "get_page_bounds":           return getPageBounds();
    default:
      throw new Error("Unknown action: " + action);
  }
}
```

### Key Utility Functions

```typescript
// Convert hex string to Figma RGB (0-1 range)
function hexToRGB(hex) {
  const v = hex.replace("#", "").trim();
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255
  };
}

// Get node by ID or throw
function getNode(id) {
  const n = figma.getNodeById(id);
  if (!n) throw new Error("Node not found: " + id);
  return n;
}

// Standard node info response (THE BOTTLENECK — see Limitations)
function nodeInfo(n) {
  return { nodeId: n.id, type: n.type, name: "name" in n ? n.name : undefined };
}

// Auto-position: places new top-level elements to the right of existing content
function resolvePosition(input, parentId) {
  if (input.x !== undefined || input.y !== undefined) {
    return { x: input.x ?? 0, y: input.y ?? 0 };
  }
  if (parentId) return { x: 0, y: 0 };
  const bounds = computePageBounds();
  if (bounds.empty) return { x: 0, y: 0 };
  return { x: bounds.maxX + 100, y: bounds.minY };
}
```

### Handler Examples

**Creating a frame:**
```typescript
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
```

**Creating text (async — requires font loading):**
```typescript
function addText(input) {
  return async () => {
    const { text, fontFamily = "Inter", fontStyle = "Regular", fontSize = 32, hex, parentId } = input;
    const pos = resolvePosition(input, parentId);

    // CRITICAL: Must load font before setting characters
    await figma.loadFontAsync({ family: fontFamily, style: fontStyle });

    const t = figma.createText();
    t.fontName = { family: fontFamily, style: fontStyle };
    t.characters = text;
    if (fontSize) t.fontSize = fontSize;
    if (hex) t.fills = [{ type: "SOLID", color: hexToRGB(hex) }];
    t.x = pos.x;
    t.y = pos.y;
    getParent(parentId).appendChild(t);
    return { nodeId: t.id, type: t.type, text: t.characters, x: pos.x, y: pos.y };
  };
}
```

**Setting auto layout:**
```typescript
function setAutoLayout(input) {
  const f = getNode(input.nodeId);
  if (f.type !== "FRAME") throw new Error("Auto Layout only on frames");
  const allowed = [
    "layoutMode",           // "HORIZONTAL" | "VERTICAL"
    "primaryAxisSizingMode", // "FIXED" | "AUTO"
    "counterAxisSizingMode", // "FIXED" | "AUTO"
    "itemSpacing",          // number (gap between children)
    "paddingTop",           // number
    "paddingRight",         // number
    "paddingBottom",        // number
    "paddingLeft",          // number
    "primaryAxisAlignItems",   // "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"
    "counterAxisAlignItems",   // "MIN" | "CENTER" | "MAX"
    "layoutWrap",              // "NO_WRAP" | "WRAP"
    "counterAxisSpacing"       // number (gap for wrapped items)
  ];
  for (const k of allowed) {
    if (k in input) f[k] = input[k];
  }
  return nodeInfo(f);
}
```

**Adding effects (shadows, blur):**
```typescript
function addEffect({ nodeId, type, radius = 8, spread = 0, hex = "#000000", opacity = 0.25, offsetX = 0, offsetY = 2 }) {
  const n = getNode(nodeId);
  const effects = [...n.effects]; // Clone existing effects array

  if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
    effects.push({ type, radius, visible: true });
  } else {
    // DROP_SHADOW or INNER_SHADOW
    const rgb = hexToRGB(hex);
    effects.push({
      type,
      radius,
      spread,
      visible: true,
      blendMode: "NORMAL",  // IMPORTANT: required by Figma's schema
      color: { r: rgb.r, g: rgb.g, b: rgb.b, a: opacity },
      offset: { x: offsetX, y: offsetY }
    });
  }
  n.effects = effects;
  return nodeInfo(n);
}
```

---

## UI Layer Deep Dive

The `ui.html` file serves as a bidirectional bridge between WebSocket and Figma's postMessage API.

### Connection Management

```javascript
var ws = null;
var autoReconnect = false;

function connect() {
  var url = getServerUrl(); // ws://127.0.0.1:3066
  ws = new WebSocket(url);

  ws.onopen = function() {
    ws.send(JSON.stringify({ hello: 'from-plugin-ui' }));
    setStatus('connected', 'Connected to ' + url);
  };

  ws.onmessage = function(ev) {
    // Forward WebSocket messages to plugin code
    var msg = JSON.parse(ev.data);
    parent.postMessage({ pluginMessage: msg }, '*');
  };

  ws.onclose = function() {
    if (autoReconnect) {
      setTimeout(connect, 3000); // Auto-reconnect every 3 seconds
    }
  };
}

// Forward plugin code replies back to WebSocket
onmessage = function(ev) {
  var msg = ev.data && ev.data.pluginMessage;
  if (!msg) return;

  // Config responses stay local
  if (msg._config) { /* handle config */ return; }

  // Everything else goes to WebSocket
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
};
```

### Config Persistence

The UI persists the server host/port using Figma's `clientStorage` API (via the plugin code):

```javascript
// Save host/port to Figma's storage
function saveConfig() {
  parent.postMessage({ pluginMessage: {
    _saveConfig: { host: hostInput.value, port: portInput.value }
  } }, '*');
}

// Load on startup
parent.postMessage({ pluginMessage: { _loadConfig: true } }, '*');
```

---

## Build Script Deep Dive

### WebSocket Server

```javascript
const { WebSocketServer } = require("ws");
const PORT = 3066;

let pluginSocket = null;
let msgId = 0;
const pending = new Map(); // id -> {resolve, reject}

function startServer() {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: PORT });

    wss.on("connection", (ws) => {
      pluginSocket = ws;

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.hello) return; // Handshake

        // Match reply to pending request
        if (msg.replyTo !== undefined && pending.has(msg.replyTo)) {
          const { resolve, reject } = pending.get(msg.replyTo);
          pending.delete(msg.replyTo);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      });

      resolve(wss);
    });
  });
}
```

### Sending Commands

```javascript
function send(action, args = {}) {
  return new Promise((resolve, reject) => {
    if (!pluginSocket) {
      reject(new Error("Plugin not connected"));
      return;
    }
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    pluginSocket.send(JSON.stringify({ id, action, args }));

    // Timeout after 15 seconds
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on action: ${action}`));
      }
    }, 15000);
  });
}

// Wrapper with delay between commands
async function cmd(action, args = {}) {
  const result = await send(action, args);
  await new Promise(r => setTimeout(r, 150)); // 150ms delay
  return result;
}
```

### Helper Functions Pattern

```javascript
// Shorthand helpers used throughout the build script
async function frame(name, w, h, parentId, opts = {}) {
  return cmd("create_frame", { name, width: w, height: h, parentId, ...opts });
}

async function rect(w, h, hex, parentId, opts = {}) {
  return cmd("create_rectangle", { width: w, height: h, hex, parentId, ...opts });
}

async function text(txt, parentId, opts = {}) {
  const defaults = { fontFamily: "Inter", fontStyle: "Regular", fontSize: 16, hex: "FFFFFF" };
  return cmd("add_text", { text: txt, parentId, ...defaults, ...opts });
}

async function fill(nodeId, hex, opacity) {
  return cmd("set_fill", { nodeId, hex, opacity });
}

async function autoLayout(nodeId, opts) {
  return cmd("set_auto_layout", { nodeId, ...opts });
}
```

### Building a Section (Real Example)

```javascript
async function buildHero(parentId) {
  // 1. Create the section frame
  const hero = await frame("Hero Section", 1440, 900, parentId);
  await fill(hero.nodeId, "000319", 1);
  await autoLayout(hero.nodeId, {
    layoutMode: "VERTICAL",
    itemSpacing: 24,
    paddingTop: 120, paddingBottom: 80,
    paddingLeft: 80, paddingRight: 80,
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
  });

  // 2. Status pill
  const pill = await frame("Status Pill", 340, 36, hero.nodeId);
  await fill(pill.nodeId, "4BFFC0", 0.08);
  await cmd("set_stroke", { nodeId: pill.nodeId, hex: "4BFFC0", opacity: 0.2, strokeWeight: 1 });
  await cmd("set_corner_radius", { nodeId: pill.nodeId, radius: 9999 });
  await autoLayout(pill.nodeId, {
    layoutMode: "HORIZONTAL",
    itemSpacing: 8,
    paddingTop: 8, paddingBottom: 8,
    paddingLeft: 16, paddingRight: 16,
    counterAxisAlignItems: "CENTER",
  });

  // 3. Green dot inside pill
  await cmd("create_ellipse", { width: 8, height: 8, hex: "4BFFC0", parentId: pill.nodeId });

  // 4. Status text
  await text("System Online  ·  All Services Operational", pill.nodeId, {
    fontFamily: "JetBrains Mono", fontStyle: "Regular",
    fontSize: 12, hex: "4BFFC0",
  });

  // 5. Headlines
  const h1 = await text("We build intelligent systems.", hero.nodeId, {
    fontFamily: "Inter", fontStyle: "Extra Bold",
    fontSize: 72, hex: "FFFFFF",
  });
  await cmd("set_text_style", { nodeId: h1.nodeId, textAlignHorizontal: "CENTER", letterSpacing: -2.16 });

  return hero;
}
```

---

## Complete Action Reference

### Creation Actions (9)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `create_frame` | `name, width, height, parentId, x, y` | `nodeId, type, name, width, height, x, y` | Create a frame/artboard |
| `create_rectangle` | `width, height, cornerRadius, hex, parentId, x, y` | `nodeId, type, x, y` | Create a rectangle |
| `create_ellipse` | `width, height, hex, parentId, x, y` | `nodeId, type, x, y` | Create an ellipse/circle |
| `create_line` | `length, rotation, strokeHex, strokeWeight, parentId, x, y` | `nodeId, type, x, y` | Create a line |
| `create_polygon` | `sides, width, height, hex, parentId, x, y` | `nodeId, type, x, y` | Create a polygon |
| `create_star` | `points, width, height, hex, parentId, x, y` | `nodeId, type, x, y` | Create a star shape |
| `add_text` | `text, fontFamily, fontStyle, fontSize, hex, parentId, x, y` | `nodeId, type, text, x, y` | Create a text node |
| `place_image_base64` | `width, height, base64, parentId, x, y` | `nodeId, type, x, y` | Place an image from base64 data |
| `create_page` | `name, makeCurrent` | `pageId, name` | Create a new page |

### Node Management Actions (11)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `rename_node` | `nodeId, name` | `nodeId, type, name` | Rename a node |
| `delete_node` | `nodeId` | `removed` | Delete a node |
| `duplicate_node` | `nodeId, x, y` | `nodeId, type, name` | Clone a node |
| `resize_node` | `nodeId, width, height` | `nodeId, type, name` | Resize a node |
| `rotate_node` | `nodeId, rotation` | `nodeId, type, name` | Rotate a node (degrees) |
| `set_position` | `nodeId, x, y` | `nodeId, type, name` | Set absolute position |
| `group_nodes` | `nodeIds[], name` | `nodeId, type, name` | Group nodes together |
| `ungroup` | `groupId` | `released[]` | Ungroup a group |
| `reparent_node` | `nodeId, newParentId, index` | `nodeId, newParent` | Move node to different parent |
| `select_nodes` | `nodeIds[]` | `selected[]` | Select nodes on canvas |
| `set_properties` | `nodeId, props{}` | `nodeId, type, name` | Set multiple properties at once |

### Styling Actions (7)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `set_fill` | `nodeId, hex, opacity` | `nodeId, type, name` | Set solid fill color |
| `set_stroke` | `nodeId, hex, opacity, strokeWeight, strokeAlign, dashPattern, cap, join` | `nodeId, type, name` | Set stroke |
| `set_corner_radius` | `nodeId, radius, topLeft, topRight, bottomRight, bottomLeft` | `nodeId, type, name` | Set corner radius |
| `set_opacity` | `nodeId, opacity` | `nodeId, type, name` | Set node opacity (0-1) |
| `set_blend_mode` | `nodeId, mode` | `nodeId, type, name` | Set blend mode |
| `add_effect` | `nodeId, type, radius, spread, hex, opacity, offsetX, offsetY` | `nodeId, type, name` | Add shadow/blur effect |
| `clear_effects` | `nodeId` | `nodeId, type, name` | Remove all effects |

### Layout Actions (5)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `set_auto_layout` | `nodeId, layoutMode, itemSpacing, padding*, alignItems, sizingMode, layoutWrap, counterAxisSpacing` | `nodeId, type, name` | Configure auto layout |
| `set_constraints` | `nodeId, horizontal, vertical` | `nodeId, type, name` | Set constraints |
| `layout_grid_add` | `nodeId, pattern, count, gutterSize, sectionSize, hex, opacity` | `nodeId, type, name` | Add layout grid |
| `layout_grid_clear` | `nodeId` | `nodeId, type, name` | Remove layout grids |
| `get_page_bounds` | _(none)_ | `bounds, suggestedNextPosition, topLevelNodes[]` | Get canvas bounds and top-level node info |

### Text Actions (3)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `set_text_content` | `nodeId, text` | `nodeId, type, name` | Change text content |
| `set_text_style` | `nodeId, fontFamily, fontStyle, fontSize, lineHeight, letterSpacing, textAlignHorizontal, textAutoResize` | `nodeId, type, name` | Change text styling |
| `set_text_color` | `nodeId, hex, opacity` | `nodeId, type, name` | Change text color |

### Component Actions (7)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `create_component` | `name, fromNodeIds[]` | `nodeId, type, name` | Create a component |
| `create_instance` | `componentId, parentId, x, y` | `nodeId, type, name, x, y` | Create component instance |
| `detach_instance` | `nodeId` | `nodeId, type, name` | Detach instance from component |
| `boolean_op` | `op, nodeIds[], name` | `nodeId, type, name` | Boolean operation (UNION/SUBTRACT/INTERSECT/EXCLUDE) |
| `get_component_properties` | `nodeId` | `nodeId, type, name, properties{}` | Read component properties |
| `set_component_properties` | `nodeId, properties{}` | `nodeId, name, updated{}` | Set variant properties |
| `list_local_components` | `pageFilter, limit` | `count, components[]` | List all components |

### Read Actions (4)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `list_pages` | _(none)_ | `pages[], currentPage` | List all pages |
| `get_page_bounds` | _(none)_ | `bounds, topLevelNodes[]` | Get page bounds and top-level nodes |
| `get_selection` | _(none)_ | `[{nodeId, type, name}]` | Get selected nodes |
| `list_local_components` | `pageFilter, limit` | `count, components[]` | List components |

### Other Actions (4)

| Action | Args | Returns | Description |
|--------|------|---------|-------------|
| `export_node` | `nodeId, format, scale` | `format, base64` | Export as PNG/JPG/SVG |
| `set_plugin_data` | `nodeId, key, value` | `nodeId` | Store custom data on a node |
| `get_plugin_data` | `nodeId, key` | `value` | Read custom data from a node |
| `search_components` | `query, limit` | `query, count, components[]` | Search components by name |

---

## Message Protocol

### Request (Build Script → Plugin)

```json
{
  "id": 1,
  "action": "create_frame",
  "args": {
    "name": "Hero Section",
    "width": 1440,
    "height": 900,
    "parentId": "11:3"
  }
}
```

### Success Response (Plugin → Build Script)

```json
{
  "replyTo": 1,
  "result": {
    "ok": true,
    "nodeId": "11:45",
    "type": "FRAME",
    "name": "Hero Section",
    "width": 1440,
    "height": 900,
    "x": 0,
    "y": 0
  }
}
```

### Error Response (Plugin → Build Script)

```json
{
  "replyTo": 1,
  "result": { "ok": false },
  "error": "The font \"Inter SemiBold\" could not be loaded"
}
```

### Handshake (Plugin → Build Script, on connect)

```json
{
  "hello": "from-plugin-ui"
}
```

---

## Known Limitations & Workarounds

### 1. Read capabilities are severely limited

**Problem:** The `nodeInfo()` function returns only `{nodeId, type, name}`. No fills, strokes, sizes, text content, fonts, effects, auto-layout settings, or children.

**Root cause:** Line 91-93 in plugin.js:
```typescript
function nodeInfo(n) {
  return { nodeId: n.id, type: n.type, name: "name" in n ? n.name : undefined };
}
```

**Workaround:** Add a `get_node_deep` action that serializes full node properties:
```typescript
case "get_node_deep":
  return getNodeDeep(input);

function getNodeDeep({ nodeId, depth = 2 }) {
  const n = getNode(nodeId);
  return serializeNode(n, depth);
}

function serializeNode(n, depth) {
  const info = {
    nodeId: n.id, type: n.type,
    name: "name" in n ? n.name : undefined,
    x: n.x, y: n.y,
    width: "width" in n ? n.width : undefined,
    height: "height" in n ? n.height : undefined,
    opacity: n.opacity,
    visible: n.visible,
  };
  if ("fills" in n) info.fills = cloneArray(n.fills);
  if ("strokes" in n) info.strokes = cloneArray(n.strokes);
  if ("effects" in n) info.effects = cloneArray(n.effects);
  if ("cornerRadius" in n) info.cornerRadius = n.cornerRadius;
  if ("characters" in n) info.characters = n.characters;
  if ("fontSize" in n) info.fontSize = n.fontSize;
  if ("fontName" in n && typeof n.fontName !== "symbol") info.fontName = n.fontName;
  if ("layoutMode" in n) info.layoutMode = n.layoutMode;
  if ("itemSpacing" in n) info.itemSpacing = n.itemSpacing;
  if (depth > 0 && "children" in n) {
    info.children = n.children.map(c => serializeNode(c, depth - 1));
  }
  return info;
}
```

### 2. Font loading errors

**Problem:** `figma.loadFontAsync()` fails if the font isn't installed on the system.

**Common errors:**
- `The font "Plus Jakarta Sans ExtraBold" could not be loaded`
- `The font "Inter SemiBold" could not be loaded`

**Workaround:** Use exact font style names that Figma recognizes:
```
Inter: "Regular", "Medium", "Bold", "Extra Bold" (not "ExtraBold")
Roboto Mono: "Regular", "Medium", "Bold"
```
Or add error resilience:
```typescript
async function addText(input) {
  try {
    await figma.loadFontAsync({ family: input.fontFamily, style: input.fontStyle });
  } catch (e) {
    // Fallback to Inter Regular
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    input.fontFamily = "Inter";
    input.fontStyle = "Regular";
  }
  // ... rest of function
}
```

### 3. No gradient support

**Problem:** The plugin only supports solid fills via `hexToRGB()`. No linear gradients, radial gradients, or mesh gradients.

**Workaround:** Fake gradients with overlapping semi-transparent shapes:
```javascript
// Create a "gradient" by stacking two rectangles with different opacities
await rect(400, 200, "6366F1", parentId, { x: 0, y: 0 });
await cmd("set_opacity", { nodeId: rect1.nodeId, opacity: 0.8 });
await rect(400, 200, "A855F7", parentId, { x: 0, y: 0 });
await cmd("set_opacity", { nodeId: rect2.nodeId, opacity: 0.3 });
```

### 4. Effect schema validation errors

**Problem:** Figma's effect schema changed across API versions. Missing `blendMode` field causes validation errors.

**Fix:** Always include `blendMode: "NORMAL"` in shadow effects:
```typescript
effects.push({
  type: "DROP_SHADOW",
  radius,
  spread,
  visible: true,
  blendMode: "NORMAL",  // REQUIRED
  color: { r: rgb.r, g: rgb.g, b: rgb.b, a: opacity },
  offset: { x: offsetX, y: offsetY }
});
```

### 5. Starter plan page limit

**Problem:** `create_page` fails on Figma Starter plan (limited to 3 pages).

**Workaround:** Use existing pages instead of creating new ones:
```javascript
const pages = await cmd("list_pages");
const targetPage = pages.pages.find(p => p.name === "My Page");
if (targetPage) {
  await cmd("set_current_page", { pageId: targetPage.pageId });
} else {
  // Only create if not at limit
  await cmd("create_page", { name: "My Page" });
}
```

### 6. WebSocket port conflicts

**Problem:** If another process (like figma-designer-mcp) is already using port 3055, the build script can't start its server.

**Workaround:** Use a different port (we used 3066) and update the plugin connection settings accordingly.

### 7. Export failures

**Problem:** `export_node` with PNG format sometimes fails with "not a function" errors.

**Root cause:** The `exportAsync` API requires specific settings format that varies by Figma version.

**Workaround:** Use simplified format without constraint:
```typescript
const bytes = await n.exportAsync({ format: "PNG" });
// Instead of:
const bytes = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
```

---

## Lessons Learned

### What Worked Well

1. **WebSocket is reliable** — Once connected, the bridge handles hundreds of commands without dropping messages
2. **Auto Layout via `set_auto_layout`** — Produces properly responsive Figma layouts
3. **Component system** — `create_component` + `create_instance` enables reusable design elements
4. **Error resilience with delays** — 150ms between commands prevents overwhelming Figma's plugin runtime
5. **Auto-positioning** — `resolvePosition()` automatically places new top-level frames to the right

### What Didn't Work

1. **No visual feedback** — Building blind without screenshots leads to many rebuild cycles
2. **Font style names** — Figma is extremely strict about exact font style strings
3. **Sequential commands** — Each element requires 3-5 separate commands (create + fill + stroke + layout + rename), making complex designs slow
4. **No batch operations** — Unlike Pencil's `batch_design`, every operation is a separate WebSocket round-trip
5. **Read limitations** — The inability to read back the design made iterative improvement impossible without user screenshots

### Performance Tips

- Use 80-150ms delay between commands (too fast overwhelms Figma, too slow makes builds take forever)
- Build parent frames first, then children (Figma needs the parent to exist before appending children)
- Use `set_properties` for bulk property updates instead of individual `set_fill`, `set_stroke`, etc.
- Group related operations (create element + style it) before moving to the next element
- For large designs, build section by section with progress logging

---

## Building Your Own Plugin

### Step 1: Create the manifest

```json
{
  "name": "figclaw",
  "id": "my-unique-plugin-id",
  "api": "1.0.0",
  "main": "plugin.js",
  "ui": "ui.html",
  "editorType": ["figma"],
  "networkAccess": {
    "allowedDomains": ["*"],
    "reasoning": "Connects to local AI agent server."
  }
}
```

### Step 2: Create the UI bridge

Minimal `ui.html` — just the WebSocket relay:

```html
<!DOCTYPE html>
<html>
<body>
<div id="status">Disconnected</div>
<input id="port" value="3066" />
<button onclick="connect()">Connect</button>

<script>
var ws = null;

function connect() {
  var port = document.getElementById('port').value;
  ws = new WebSocket('ws://127.0.0.1:' + port);

  ws.onopen = function() {
    document.getElementById('status').textContent = 'Connected';
    ws.send(JSON.stringify({ hello: 'plugin' }));
  };

  ws.onmessage = function(ev) {
    parent.postMessage({ pluginMessage: JSON.parse(ev.data) }, '*');
  };

  ws.onclose = function() {
    document.getElementById('status').textContent = 'Disconnected';
    setTimeout(connect, 3000);
  };
}

onmessage = function(ev) {
  var msg = ev.data && ev.data.pluginMessage;
  if (msg && ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
};
</script>
</body>
</html>
```

### Step 3: Create the plugin handler

Minimal `plugin.js`:

```javascript
figma.showUI(__html__, { visible: true, width: 300, height: 200 });

figma.ui.onmessage = async (msg) => {
  if (msg.hello) return;

  const { id, action, args } = msg;
  try {
    let result;

    switch (action) {
      case "create_frame": {
        const f = figma.createFrame();
        f.name = args.name || "Frame";
        f.resize(args.width || 400, args.height || 300);
        if (args.parentId) {
          figma.getNodeById(args.parentId).appendChild(f);
        }
        result = { nodeId: f.id, name: f.name };
        break;
      }

      case "add_text": {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        const t = figma.createText();
        t.characters = args.text;
        if (args.parentId) {
          figma.getNodeById(args.parentId).appendChild(t);
        }
        result = { nodeId: t.id };
        break;
      }

      // Add your own actions here...

      default:
        throw new Error("Unknown action: " + action);
    }

    figma.ui.postMessage({ replyTo: id, result: { ok: true, ...result } });
  } catch (e) {
    figma.ui.postMessage({ replyTo: id, result: { ok: false }, error: e.message });
  }
};
```

### Step 4: Create the Node.js client

```javascript
const { WebSocketServer } = require("ws");

const wss = new WebSocketServer({ port: 3066 });
let plugin = null;
let msgId = 0;
const pending = new Map();

wss.on("connection", (ws) => {
  console.log("Plugin connected!");
  plugin = ws;

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.hello) return;
    if (msg.replyTo && pending.has(msg.replyTo)) {
      const { resolve, reject } = pending.get(msg.replyTo);
      pending.delete(msg.replyTo);
      msg.error ? reject(new Error(msg.error)) : resolve(msg.result);
    }
  });
});

function send(action, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    plugin.send(JSON.stringify({ id, action, args }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error("Timeout")); }
    }, 15000);
  });
}

// Usage:
async function main() {
  // Wait for connection...
  const frame = await send("create_frame", { name: "Hello", width: 800, height: 600 });
  console.log("Created frame:", frame.nodeId);

  await send("add_text", { text: "Hello World!", parentId: frame.nodeId });
}
```

### Step 5: Install in Figma

1. Open Figma desktop app
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select your `manifest.json`
4. Open a design file
5. Run: **Plugins > Development > figclaw**
6. Enter port, click Connect
7. Run your Node.js script

---

## Comparison with Pencil MCP

| Feature | figclaw (WebSocket plugin) | Pencil MCP |
|---------|--------------------------|------------|
| **Setup** | Build script + plugin + manual connection | Automatic (MCP built into Claude Code) |
| **Write** | 42 individual actions, 1 per call | `batch_design` — 25 ops per call |
| **Read** | 4 actions, returns {id, type, name} only | Full node trees, screenshots, layout snapshots |
| **Images** | base64 encoding required | `G()` — AI/stock image generation |
| **Screenshots** | Not working reliably | `get_screenshot(nodeId)` — inline images |
| **Gradients** | Solid fills only | Linear, radial, mesh, angular gradients |
| **Effects** | Limited (strict schema validation) | Shadows, blur, background blur |
| **Fonts** | Must load async, strict style names | Automatic handling |
| **Speed** | ~150ms per operation | Batch operations, much faster |
| **Iteration** | Run script → restart for changes | Live modification in conversation |
| **Cost** | Free (Figma + plugin) | Pencil subscription |
| **Export** | Figma native (to code, assets) | React, Vue, Svelte, HTML, PNG, SVG, PDF |
| **Collaboration** | Figma's full collaboration features | Local file only |
| **Ecosystem** | Massive plugin/community ecosystem | Growing, newer platform |

### When to Use Figma Plugin
- You need Figma's collaboration features
- Your team already uses Figma
- You need access to Figma's component libraries
- You want to modify existing Figma files

### When to Use Pencil MCP
- You're designing from scratch with AI
- You need visual feedback during generation (screenshots)
- You want AI-generated images inline
- You need gradient/blur support
- You want faster iteration cycles

---

## Resources

- [Figma Plugin API Docs](https://developers.figma.com/docs/plugin-api/)
- [Figma Plugin API Reference](https://www.figma.com/plugin-docs/api/api-reference/)
- [WebSocket npm package](https://www.npmjs.com/package/ws)
- [figma-designer-mcp (original inspiration)](https://github.com/a1245582339/figma-designer)
- [cursor-talk-to-figma-mcp (alternative)](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp)
- [Pencil.dev Documentation](https://docs.pencil.dev/)
