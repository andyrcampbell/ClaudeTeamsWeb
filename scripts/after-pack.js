// electron-builder afterPack hook: restore the execute bit on node-pty's
// spawn-helper inside the packaged macOS app.
//
// On macOS node-pty does not exec the shell directly — it posix_spawn()s this
// small helper binary to acquire a controlling terminal, resolving it as
// <prebuilds dir>/spawn-helper (see node-pty/lib/unixTerminal.js). The copy
// that lands in app.asar.unpacked comes out mode 0644, so every pty.spawn()
// dies with "posix_spawnp failed" and no terminal can start. node-pty's own
// postinstall doesn't cover this: it only chmods build/Release/spawn-helper,
// which prebuildify-based installs never produce.

const fs = require("fs");
const path = require("path");

function chmodHelpers(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += chmodHelpers(full);
    } else if (entry.name === "spawn-helper") {
      fs.chmodSync(full, 0o755);
      count += 1;
    }
  }
  return count;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const ptyDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "node-pty"
  );

  // Fail the build rather than quietly shipping another unusable .dmg.
  if (!fs.existsSync(ptyDir)) {
    throw new Error(`afterPack: expected unpacked node-pty at ${ptyDir}`);
  }
  const count = chmodHelpers(ptyDir);
  if (count === 0) {
    throw new Error(`afterPack: no spawn-helper found under ${ptyDir}`);
  }
  console.log(`  • afterPack  chmod 755 applied to ${count} spawn-helper binaries`);
};
