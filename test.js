// test.js — Validates the figclaw module loads correctly and exports are intact
// Run: node test.js

const figclaw = require("./figclaw");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log("  \u2713 " + msg);
  } else {
    failed++;
    console.error("  \u2717 " + msg);
  }
}

console.log("figclaw module tests\n");

// Test 1: Module loads
console.log("Module loading:");
assert(typeof figclaw === "object", "Module exports an object");

// Test 2: Core exports exist
console.log("\nCore exports:");
assert(typeof figclaw.startServer === "function", "startServer is a function");
assert(typeof figclaw.waitForConnection === "function", "waitForConnection is a function");
assert(typeof figclaw.send === "function", "send is a function");
assert(typeof figclaw.cmd === "function", "cmd is a function");

// Test 3: Creation helpers
console.log("\nCreation helpers:");
const creationHelpers = ["frame", "rect", "ellipse", "line", "polygon", "star", "text", "image"];
for (const name of creationHelpers) {
  assert(typeof figclaw[name] === "function", name + " is a function");
}

// Test 4: Styling helpers
console.log("\nStyling helpers:");
const stylingHelpers = ["fill", "stroke", "cornerRadius", "opacity", "autoLayout", "shadow", "blur"];
for (const name of stylingHelpers) {
  assert(typeof figclaw[name] === "function", name + " is a function");
}

// Test 5: Node management helpers
console.log("\nNode management helpers:");
const nodeHelpers = ["rename", "remove", "move", "resize", "group"];
for (const name of nodeHelpers) {
  assert(typeof figclaw[name] === "function", name + " is a function");
}

// Test 6: Read helpers
console.log("\nRead helpers:");
const readHelpers = ["findNodes", "getDeep"];
for (const name of readHelpers) {
  assert(typeof figclaw[name] === "function", name + " is a function");
}

// Test 7: send rejects when not connected
console.log("\nError handling:");
figclaw.send("create_frame", {}).then(
  () => {
    failed++;
    console.error("  \u2717 send should reject when not connected");
    finish();
  },
  (err) => {
    assert(err.message.includes("not connected"), "send rejects when plugin not connected");
    finish();
  }
);

function finish() {
  console.log("\n" + "=".repeat(40));
  console.log("Results: " + passed + " passed, " + failed + " failed");
  console.log("=".repeat(40));
  process.exit(failed > 0 ? 1 : 0);
}
