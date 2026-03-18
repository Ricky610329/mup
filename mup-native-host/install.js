#!/usr/bin/env node
// MUP Native Host Installer
// Registers the native messaging host with Chrome/Chromium.
// Run once: node install.js

const fs = require("fs");
const path = require("path");
const os = require("os");

const HOST_NAME = "com.mup.native";
const HOST_DESCRIPTION = "MUP Native Host — file system and OS access for MUP extension";

// Detect the extension ID from command line or use wildcard
const extensionId = process.argv[2] || null;

const hostPath = path.resolve(__dirname, "host.js");
const nodePath = process.execPath; // path to node binary

// The native messaging manifest
const manifest = {
  name: HOST_NAME,
  description: HOST_DESCRIPTION,
  path: process.platform === "win32"
    ? path.resolve(__dirname, "host.bat") // Windows needs a .bat wrapper
    : hostPath,
  type: "stdio",
  allowed_origins: extensionId
    ? [`chrome-extension://${extensionId}/`]
    : ["chrome-extension://*/"], // allow any extension (dev mode)
};

// Windows .bat wrapper (Chrome can't run .js directly)
if (process.platform === "win32") {
  const batContent = `@echo off\r\n"${nodePath}" "${hostPath}" %*\r\n`;
  const batPath = path.resolve(__dirname, "host.bat");
  fs.writeFileSync(batPath, batContent);
  console.log("Created:", batPath);
}

// Write manifest
const manifestJson = JSON.stringify(manifest, null, 2);

if (process.platform === "win32") {
  // Windows: write manifest + add registry key
  const manifestPath = path.resolve(__dirname, HOST_NAME + ".json");
  fs.writeFileSync(manifestPath, manifestJson);
  console.log("Created:", manifestPath);

  // Add registry key
  const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
  const { execSync } = require("child_process");
  try {
    execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: "pipe" });
    console.log("Registry key added:", regKey);
  } catch (e) {
    console.error("Failed to add registry key. Try running as administrator.");
    console.error("Manual command:");
    console.error(`  reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`);
  }
} else if (process.platform === "darwin") {
  // macOS
  const dir = path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, HOST_NAME + ".json");
  // macOS needs the full node path in the manifest
  manifest.path = hostPath;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.chmodSync(hostPath, "755");
  console.log("Created:", manifestPath);
} else {
  // Linux
  const dir = path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts");
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, HOST_NAME + ".json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.chmodSync(hostPath, "755");
  console.log("Created:", manifestPath);
}

console.log("\n✓ MUP Native Host installed!");
console.log("  Host name:", HOST_NAME);
console.log("  Extension can now access your file system.\n");
