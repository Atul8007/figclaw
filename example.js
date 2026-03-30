// example.js — Demo script showing how to use figclaw to build a simple card in Figma
//
// 1. Open Figma and run the figclaw plugin
// 2. Connect to ws://127.0.0.1:3066
// 3. Run: node example.js

const { startServer, waitForConnection, frame, rect, text, fill, stroke, cornerRadius, autoLayout, shadow, cmd } = require("./figclaw");

async function buildCard() {
  // Card container
  const card = await frame("Card", 360, 280);
  await fill(card.nodeId, "FFFFFF", 1);
  await cornerRadius(card.nodeId, 16);
  await shadow(card.nodeId, { radius: 24, opacity: 0.08, offsetY: 8 });
  await autoLayout(card.nodeId, {
    layoutMode: "VERTICAL",
    itemSpacing: 16,
    paddingTop: 24,
    paddingBottom: 24,
    paddingLeft: 24,
    paddingRight: 24,
  });

  // Header area
  const header = await frame("Header", 312, 40, card.nodeId);
  await fill(header.nodeId, "FFFFFF", 0);
  await autoLayout(header.nodeId, {
    layoutMode: "HORIZONTAL",
    itemSpacing: 12,
    counterAxisAlignItems: "CENTER",
  });

  // Avatar circle
  const avatar = await cmd("create_ellipse", { width: 40, height: 40, hex: "6366F1", parentId: header.nodeId });

  // Title text
  await text("figclaw Demo Card", header.nodeId, {
    fontFamily: "Inter",
    fontStyle: "Bold",
    fontSize: 16,
    hex: "111827",
  });

  // Description
  await text(
    "This card was created programmatically using figclaw. AI agents can build entire Figma designs through simple WebSocket commands.",
    card.nodeId,
    {
      fontFamily: "Inter",
      fontStyle: "Regular",
      fontSize: 14,
      hex: "6B7280",
    }
  );

  // Button
  const btn = await frame("Button", 312, 44, card.nodeId);
  await fill(btn.nodeId, "6366F1", 1);
  await cornerRadius(btn.nodeId, 8);
  await autoLayout(btn.nodeId, {
    layoutMode: "HORIZONTAL",
    primaryAxisAlignItems: "CENTER",
    counterAxisAlignItems: "CENTER",
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 20,
    paddingRight: 20,
  });

  await text("Get Started", btn.nodeId, {
    fontFamily: "Inter",
    fontStyle: "Medium",
    fontSize: 14,
    hex: "FFFFFF",
  });

  console.log("[example] Card built successfully! nodeId:", card.nodeId);
}

async function main() {
  await startServer();
  console.log("[example] Waiting for Figma plugin to connect...");
  await waitForConnection();
  console.log("[example] Building demo card...");
  await buildCard();
  console.log("[example] Done! Check your Figma canvas.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[example] Error:", err.message);
  process.exit(1);
});
