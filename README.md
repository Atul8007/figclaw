# figclaw

A WebSocket-based Figma plugin that lets AI agents (Claude Code, Cursor, etc.) create and modify Figma designs programmatically.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Import the plugin into Figma

1. Open Figma desktop app
2. Go to **Plugins > Development > Import plugin from manifest...**
3. Select the `manifest.json` from this repo
4. Open any design file

### 3. Run the plugin

1. In Figma: **Plugins > Development > figclaw**
2. Enter `127.0.0.1` and port `3066` (defaults)
3. Click **Connect**

### 4. Run the example

```bash
node example.js
```

This builds a demo card in your Figma canvas to verify everything works.

## How It Works

```
AI Agent (Claude Code)          Node.js Client              Figma Plugin
       |                             |                           |
       |  require("./figclaw")       |                           |
       |  startServer()              |                           |
       |  ─── creates ──────────► WS Server (port 3066)         |
       |                             |                           |
       |                             | ◄── plugin connects ──── |
       |                             |                           |
       |  frame("Hero", 1440, 900)   |                           |
       |  ─── cmd() ────────────► sends JSON ──────────────────► |
       |                             |                     figma.createFrame()
       |                             | ◄── result ────────────── |
       |  ◄── { nodeId: "11:3" } ────|                           |
```

Figma's security model requires three layers:
- **plugin.js** — runs in Figma's sandbox, has `figma.*` API access but no network
- **ui.html** — runs in Figma's iframe, has network access (WebSocket) but no `figma.*` API
- **figclaw.js** — Node.js client that AI agents use to send commands

The UI bridges WebSocket messages between the Node.js client and the plugin code.

## Usage

### As a library (recommended)

```javascript
const { startServer, waitForConnection, frame, rect, text, fill, autoLayout } = require("./figclaw");

async function main() {
  await startServer();
  await waitForConnection();

  // Create a hero section
  const hero = await frame("Hero", 1440, 900);
  await fill(hero.nodeId, "000319", 1);
  await autoLayout(hero.nodeId, {
    layoutMode: "VERTICAL",
    itemSpacing: 24,
    paddingTop: 120,
    paddingBottom: 80,
    paddingLeft: 80,
    paddingRight: 80,
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
  });

  // Add text
  await text("We build intelligent systems.", hero.nodeId, {
    fontFamily: "Inter",
    fontStyle: "Extra Bold",
    fontSize: 72,
    hex: "FFFFFF",
  });
}

main();
```

### Using raw commands

```javascript
const { startServer, waitForConnection, cmd } = require("./figclaw");

await startServer();
await waitForConnection();

// Any action from the action reference
const result = await cmd("create_frame", { name: "My Frame", width: 800, height: 600 });
console.log(result.nodeId);
```

## API Reference

### Server Functions

| Function | Description |
|----------|-------------|
| `startServer(port?)` | Start WebSocket server (default port: 3066) |
| `waitForConnection(timeout?)` | Wait for Figma plugin to connect (default: 60s) |

### Core Functions

| Function | Description |
|----------|-------------|
| `cmd(action, args)` | Send any action to the plugin with automatic delay |
| `send(action, args)` | Send action without delay (for advanced use) |

### Creation Helpers

| Function | Signature |
|----------|-----------|
| `frame` | `frame(name, width, height, parentId?, opts?)` |
| `rect` | `rect(width, height, hex, parentId?, opts?)` |
| `ellipse` | `ellipse(width, height, hex, parentId?, opts?)` |
| `line` | `line(length, parentId?, opts?)` |
| `polygon` | `polygon(sides, width, height, hex, parentId?, opts?)` |
| `star` | `star(points, width, height, hex, parentId?, opts?)` |
| `text` | `text(content, parentId?, opts?)` |
| `image` | `image(base64, width, height, parentId?, opts?)` |

### Styling Helpers

| Function | Signature |
|----------|-----------|
| `fill` | `fill(nodeId, hex, opacity?)` |
| `stroke` | `stroke(nodeId, hex, opts?)` |
| `cornerRadius` | `cornerRadius(nodeId, radius)` |
| `opacity` | `opacity(nodeId, value)` |
| `autoLayout` | `autoLayout(nodeId, opts)` |
| `shadow` | `shadow(nodeId, opts?)` |
| `blur` | `blur(nodeId, radius)` |

### Node Management Helpers

| Function | Signature |
|----------|-----------|
| `rename` | `rename(nodeId, name)` |
| `remove` | `remove(nodeId)` |
| `move` | `move(nodeId, x, y)` |
| `resize` | `resize(nodeId, width, height)` |
| `group` | `group(nodeIds[], name?)` |

### Read Helpers

| Function | Signature |
|----------|-----------|
| `findNodes` | `findNodes(name?, type?)` |
| `getDeep` | `getDeep(nodeId, depth?)` — returns full node tree with properties |

## Complete Action Reference

All 48 actions available via `cmd(action, args)`:

### Creation (9)

| Action | Key Args |
|--------|----------|
| `create_frame` | `name, width, height, parentId, x, y` |
| `create_rectangle` | `width, height, cornerRadius, hex, parentId` |
| `create_ellipse` | `width, height, hex, parentId` |
| `create_line` | `length, rotation, strokeHex, strokeWeight, parentId` |
| `create_polygon` | `sides, width, height, hex, parentId` |
| `create_star` | `points, width, height, hex, parentId` |
| `add_text` | `text, fontFamily, fontStyle, fontSize, hex, parentId` |
| `place_image_base64` | `width, height, base64, parentId` |
| `create_page` | `name, makeCurrent` |

### Node Management (11)

| Action | Key Args |
|--------|----------|
| `rename_node` | `nodeId, name` |
| `delete_node` | `nodeId` |
| `duplicate_node` | `nodeId, x, y` |
| `resize_node` | `nodeId, width, height` |
| `rotate_node` | `nodeId, rotation` |
| `set_position` | `nodeId, x, y` |
| `group_nodes` | `nodeIds[], name` |
| `ungroup` | `groupId` |
| `reparent_node` | `nodeId, newParentId, index` |
| `select_nodes` | `nodeIds[]` |
| `set_properties` | `nodeId, props{}` |

### Styling (7)

| Action | Key Args |
|--------|----------|
| `set_fill` | `nodeId, hex, opacity` |
| `set_stroke` | `nodeId, hex, opacity, strokeWeight, strokeAlign` |
| `set_corner_radius` | `nodeId, radius` (or `topLeft, topRight, bottomRight, bottomLeft`) |
| `set_opacity` | `nodeId, opacity` |
| `set_blend_mode` | `nodeId, mode` |
| `add_effect` | `nodeId, type (DROP_SHADOW/INNER_SHADOW/LAYER_BLUR/BACKGROUND_BLUR), radius, hex, opacity, offsetX, offsetY` |
| `clear_effects` | `nodeId` |

### Layout (4)

| Action | Key Args |
|--------|----------|
| `set_auto_layout` | `nodeId, layoutMode, itemSpacing, paddingTop/Right/Bottom/Left, primaryAxisAlignItems, counterAxisAlignItems` |
| `set_constraints` | `nodeId, horizontal, vertical` |
| `layout_grid_add` | `nodeId, pattern, count, gutterSize, sectionSize` |
| `layout_grid_clear` | `nodeId` |

### Text (3)

| Action | Key Args |
|--------|----------|
| `set_text_content` | `nodeId, text` |
| `set_text_style` | `nodeId, fontFamily, fontStyle, fontSize, lineHeight, letterSpacing, textAlignHorizontal` |
| `set_text_color` | `nodeId, hex, opacity` |

### Components (8)

| Action | Key Args |
|--------|----------|
| `create_component` | `name, fromNodeIds[]` |
| `create_instance` | `componentId, parentId, x, y` |
| `detach_instance` | `nodeId` |
| `boolean_op` | `op (UNION/SUBTRACT/INTERSECT/EXCLUDE), nodeIds[]` |
| `get_component_properties` | `nodeId` |
| `set_component_properties` | `nodeId, properties{}` |
| `list_local_components` | `pageFilter, limit` |
| `search_components` | `query, limit` |

### Read (6)

| Action | Key Args |
|--------|----------|
| `find_nodes` | `name, type` |
| `find_nodes_all_pages` | `name, type` |
| `get_selection` | _(none)_ |
| `list_pages` | _(none)_ |
| `get_page_bounds` | _(none)_ |
| `get_node_deep` | `nodeId, depth` — full property tree |

### Other (3)

| Action | Key Args |
|--------|----------|
| `export_node` | `nodeId, format (PNG/JPG/SVG), scale` |
| `set_plugin_data` | `nodeId, key, value` |
| `get_plugin_data` | `nodeId, key` |

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FIGCLAW_PORT` | `3066` | WebSocket server port |
| `FIGCLAW_DELAY` | `150` | Delay (ms) between commands |
| `FIGCLAW_TIMEOUT` | `15000` | Command timeout (ms) |

## Project Structure

```
figclaw/
├── manifest.json      # Figma plugin manifest
├── plugin.js          # Plugin code (Figma sandbox, 48 actions)
├── ui.html            # Plugin UI (WebSocket bridge)
├── figclaw.js         # Node.js client library
├── example.js         # Demo: builds a card in Figma
├── test.js            # Module validation tests
└── package.json       # Node.js dependencies
```

## Tips

- **Font names must be exact** — Use `"Extra Bold"` not `"ExtraBold"`. The plugin falls back to Inter Regular on font errors.
- **Build parent frames first** — Figma needs a parent node to exist before you can append children.
- **Use `autoLayout`** — Produces properly responsive Figma layouts instead of absolute positioning.
- **New top-level frames auto-position** — When no `x/y` is specified, frames are placed to the right of existing content.
- **Use `getDeep`** — To inspect the full property tree of any node (fills, strokes, effects, children, etc.).
- **Adjust delay for your machine** — Lower `FIGCLAW_DELAY` for speed, raise it if Figma drops commands.

## License

MIT
