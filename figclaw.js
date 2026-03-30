#!/usr/bin/env node
// figclaw.js — Node.js client library for the figclaw Figma plugin
// Creates a WebSocket server and provides a simple API to send design commands to Figma.
//
// Usage:
//   const { startServer, cmd, frame, rect, text, fill, autoLayout } = require("./figclaw");
//   await startServer();
//   const hero = await frame("Hero", 1440, 900);
//   await fill(hero.nodeId, "000319", 1);

const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.FIGCLAW_PORT || "3066", 10);
const CMD_DELAY = parseInt(process.env.FIGCLAW_DELAY || "150", 10);
const CMD_TIMEOUT = parseInt(process.env.FIGCLAW_TIMEOUT || "15000", 10);

let pluginSocket = null;
let msgId = 0;
const pending = new Map();

// ── Server ─────────────────────────────────────────────────────────────

function startServer(port) {
  const p = port || PORT;
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: p });

    wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${p} is already in use. Set FIGCLAW_PORT env var to use a different port.`));
      } else {
        reject(err);
      }
    });

    wss.on("listening", () => {
      console.log(`[figclaw] WebSocket server listening on ws://127.0.0.1:${p}`);
      console.log(`[figclaw] Open Figma → Plugins → Development → figclaw → Enter port ${p} → Connect`);
    });

    wss.on("connection", (ws) => {
      console.log("[figclaw] Plugin connected!");
      pluginSocket = ws;

      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.hello) {
          console.log("[figclaw] Handshake received:", msg.hello);
          return;
        }
        if (msg.replyTo !== undefined && pending.has(msg.replyTo)) {
          const { resolve, reject } = pending.get(msg.replyTo);
          pending.delete(msg.replyTo);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.result);
        }
      });

      ws.on("close", () => {
        console.log("[figclaw] Plugin disconnected");
        pluginSocket = null;
      });

      resolve(wss);
    });
  });
}

// Wait for the plugin to connect (useful in scripts)
function waitForConnection(timeoutMs = 60000) {
  if (pluginSocket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (pluginSocket) {
        clearInterval(check);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        reject(new Error("Timed out waiting for plugin connection"));
      }
    }, 500);
  });
}

// ── Command Sending ────────────────────────────────────────────────────

function send(action, args = {}) {
  return new Promise((resolve, reject) => {
    if (!pluginSocket) {
      reject(new Error("Plugin not connected. Open Figma and run the figclaw plugin."));
      return;
    }
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    pluginSocket.send(JSON.stringify({ id, action, args }));

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout after ${CMD_TIMEOUT}ms on action: ${action}`));
      }
    }, CMD_TIMEOUT);
  });
}

async function cmd(action, args = {}) {
  const result = await send(action, args);
  if (CMD_DELAY > 0) {
    await new Promise((r) => setTimeout(r, CMD_DELAY));
  }
  return result;
}

// ── Shorthand Helpers ──────────────────────────────────────────────────

async function frame(name, width, height, parentId, opts = {}) {
  return cmd("create_frame", { name, width, height, parentId, ...opts });
}

async function rect(width, height, hex, parentId, opts = {}) {
  return cmd("create_rectangle", { width, height, hex, parentId, ...opts });
}

async function ellipse(width, height, hex, parentId, opts = {}) {
  return cmd("create_ellipse", { width, height, hex, parentId, ...opts });
}

async function line(length, parentId, opts = {}) {
  return cmd("create_line", { length, parentId, ...opts });
}

async function polygon(sides, width, height, hex, parentId, opts = {}) {
  return cmd("create_polygon", { sides, width, height, hex, parentId, ...opts });
}

async function star(points, width, height, hex, parentId, opts = {}) {
  return cmd("create_star", { points, width, height, hex, parentId, ...opts });
}

async function text(txt, parentId, opts = {}) {
  const defaults = { fontFamily: "Inter", fontStyle: "Regular", fontSize: 16, hex: "FFFFFF" };
  return cmd("add_text", { text: txt, parentId, ...defaults, ...opts });
}

async function image(base64, width, height, parentId, opts = {}) {
  return cmd("place_image_base64", { base64, width, height, parentId, ...opts });
}

async function fill(nodeId, hex, opacity) {
  return cmd("set_fill", { nodeId, hex, opacity });
}

async function stroke(nodeId, hex, opts = {}) {
  return cmd("set_stroke", { nodeId, hex, ...opts });
}

async function cornerRadius(nodeId, radius) {
  return cmd("set_corner_radius", { nodeId, radius });
}

async function opacity(nodeId, value) {
  return cmd("set_opacity", { nodeId, opacity: value });
}

async function autoLayout(nodeId, opts) {
  return cmd("set_auto_layout", { nodeId, ...opts });
}

async function shadow(nodeId, opts = {}) {
  return cmd("add_effect", { nodeId, type: "DROP_SHADOW", ...opts });
}

async function blur(nodeId, radius) {
  return cmd("add_effect", { nodeId, type: "LAYER_BLUR", radius });
}

async function rename(nodeId, name) {
  return cmd("rename_node", { nodeId, name });
}

async function remove(nodeId) {
  return cmd("delete_node", { nodeId });
}

async function move(nodeId, x, y) {
  return cmd("set_position", { nodeId, x, y });
}

async function resize(nodeId, width, height) {
  return cmd("resize_node", { nodeId, width, height });
}

async function group(nodeIds, name) {
  return cmd("group_nodes", { nodeIds, name });
}

async function findNodes(name, type) {
  return cmd("find_nodes", { name, type });
}

async function getDeep(nodeId, depth = 2) {
  return cmd("get_node_deep", { nodeId, depth });
}

// ── Exports ────────────────────────────────────────────────────────────

module.exports = {
  // Server
  startServer,
  waitForConnection,

  // Core
  send,
  cmd,

  // Creation helpers
  frame,
  rect,
  ellipse,
  line,
  polygon,
  star,
  text,
  image,

  // Styling helpers
  fill,
  stroke,
  cornerRadius,
  opacity,
  autoLayout,
  shadow,
  blur,

  // Node management helpers
  rename,
  remove,
  move,
  resize,
  group,

  // Read helpers
  findNodes,
  getDeep,
};
