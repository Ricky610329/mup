#!/usr/bin/env node
// MUP Native Messaging Host
// Receives commands from Chrome extension, executes OS operations, returns results.
// Protocol: Chrome native messaging (4-byte length prefix + JSON)

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// ---- Native messaging I/O ----
function readMessage() {
  return new Promise((resolve) => {
    let lenBuf = Buffer.alloc(0);

    function onData(chunk) {
      lenBuf = Buffer.concat([lenBuf, chunk]);

      if (lenBuf.length >= 4) {
        const msgLen = lenBuf.readUInt32LE(0);
        const remaining = lenBuf.slice(4);

        if (remaining.length >= msgLen) {
          process.stdin.removeListener("data", onData);
          const msg = JSON.parse(remaining.slice(0, msgLen).toString("utf-8"));
          // Put back any extra bytes
          if (remaining.length > msgLen) {
            process.stdin.unshift(remaining.slice(msgLen));
          }
          resolve(msg);
        }
      }
    }

    process.stdin.on("data", onData);
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(buf.length, 0);
  process.stdout.write(lenBuf);
  process.stdout.write(buf);
}

// ---- File system operations ----
async function handleCommand(msg) {
  const { id, type, params } = msg;

  try {
    let result;

    switch (type) {
      case "ping":
        result = { ok: true, version: "0.1.0" };
        break;

      case "selectFolder": {
        // Show OS folder picker dialog
        const folderPath = await showFolderPicker();
        result = { path: folderPath };
        break;
      }

      case "listDir": {
        const dirPath = params.path;
        if (!dirPath) throw new Error("path required");
        const entries = await listDirectory(dirPath);
        result = { entries };
        break;
      }

      case "readFile": {
        const filePath = params.path;
        if (!filePath) throw new Error("path required");
        const stat = fs.statSync(filePath);
        if (stat.size > 1024 * 1024) throw new Error("File too large (>1MB)");
        const content = fs.readFileSync(filePath, "utf-8");
        result = { content, size: stat.size };
        break;
      }

      case "moveFile": {
        const { from, to } = params;
        if (!from || !to) throw new Error("from and to required");
        // Ensure target directory exists
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        result = { ok: true };
        break;
      }

      case "createFolder": {
        const folderPath = params.path;
        if (!folderPath) throw new Error("path required");
        fs.mkdirSync(folderPath, { recursive: true });
        result = { ok: true };
        break;
      }

      case "deleteFile": {
        const filePath = params.path;
        if (!filePath) throw new Error("path required");
        fs.rmSync(filePath, { recursive: true });
        result = { ok: true };
        break;
      }

      case "capturePhoto": {
        // Capture a photo from the webcam using system tools
        const photoBase64 = await captureWebcam();
        result = { dataUrl: "data:image/jpeg;base64," + photoBase64 };
        break;
      }

      case "getFileInfo": {
        const filePath = params.path;
        if (!filePath) throw new Error("path required");
        const stat = fs.statSync(filePath);
        result = {
          name: path.basename(filePath),
          size: stat.size,
          isDirectory: stat.isDirectory(),
          lastModified: stat.mtimeMs,
        };
        break;
      }

      default:
        throw new Error("Unknown command: " + type);
    }

    sendMessage({ id, type: "result", data: result });
  } catch (err) {
    sendMessage({ id, type: "error", message: err.message });
  }
}

async function listDirectory(dirPath) {
  const entries = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const entry = {
      name: item.name,
      path: fullPath,
      kind: item.isDirectory() ? "directory" : "file",
    };
    if (item.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        entry.size = stat.size;
        entry.lastModified = stat.mtimeMs;
      } catch {}
    }
    entries.push(entry);
  }
  entries.sort((a, b) =>
    a.kind !== b.kind
      ? a.kind === "directory" ? -1 : 1
      : a.name.localeCompare(b.name)
  );
  return entries;
}

function captureWebcam() {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(require("os").tmpdir(), "mup-capture-" + Date.now() + ".jpg");

    if (process.platform === "win32") {
      // Windows: use ffmpeg to capture one frame from webcam
      // Requires ffmpeg installed. Falls back to PowerShell .NET capture.
      const ffmpegCmd = `ffmpeg -f dshow -i video="0" -frames:v 1 -y "${tmpFile}" 2>nul`;
      const psCmd = `
        Add-Type -AssemblyName System.Drawing
        Add-Type -AssemblyName System.Windows.Forms
        $devices = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()
        # Fallback: take a screenshot instead of webcam
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bmp.Save('${tmpFile.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
      `.replace(/\n/g, " ");

      // Try ffmpeg first, fall back to screenshot
      exec(ffmpegCmd, (err) => {
        if (!err && fs.existsSync(tmpFile)) {
          const base64 = fs.readFileSync(tmpFile, "base64");
          fs.unlinkSync(tmpFile);
          return resolve(base64);
        }
        // Fallback: PowerShell screenshot
        exec(`powershell -Command "${psCmd}"`, (err2) => {
          if (err2 || !fs.existsSync(tmpFile)) {
            return reject(new Error("Camera capture failed. Install ffmpeg for webcam support."));
          }
          const base64 = fs.readFileSync(tmpFile, "base64");
          fs.unlinkSync(tmpFile);
          resolve(base64);
        });
      });
    } else if (process.platform === "darwin") {
      // macOS: use imagesnap (brew install imagesnap) or screencapture
      exec(`imagesnap -w 1 "${tmpFile}" 2>/dev/null`, (err) => {
        if (!err && fs.existsSync(tmpFile)) {
          const base64 = fs.readFileSync(tmpFile, "base64");
          fs.unlinkSync(tmpFile);
          return resolve(base64);
        }
        // Fallback: screenshot
        exec(`screencapture -x -t jpg "${tmpFile}"`, (err2) => {
          if (err2 || !fs.existsSync(tmpFile)) return reject(new Error("Capture failed"));
          const base64 = fs.readFileSync(tmpFile, "base64");
          fs.unlinkSync(tmpFile);
          resolve(base64);
        });
      });
    } else {
      // Linux: use fswebcam or screenshot
      exec(`fswebcam -r 1280x720 --jpeg 80 -D 1 "${tmpFile}" 2>/dev/null`, (err) => {
        if (!err && fs.existsSync(tmpFile)) {
          const base64 = fs.readFileSync(tmpFile, "base64");
          fs.unlinkSync(tmpFile);
          return resolve(base64);
        }
        reject(new Error("Camera capture failed. Install fswebcam."));
      });
    }
  });
}

function showFolderPicker() {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      // Windows: PowerShell folder picker
      const ps = `
        Add-Type -AssemblyName System.Windows.Forms
        $d = New-Object System.Windows.Forms.FolderBrowserDialog
        $d.Description = 'Select a folder for MUP File Organizer'
        if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath } else { '' }
      `.replace(/\n/g, " ");
      exec(`powershell -Command "${ps}"`, (err, stdout) => {
        if (err) return reject(err);
        const selected = stdout.trim();
        if (!selected) return reject(new Error("No folder selected"));
        resolve(selected);
      });
    } else if (process.platform === "darwin") {
      // macOS: osascript folder picker
      exec(
        `osascript -e 'POSIX path of (choose folder with prompt "Select a folder for MUP")'`,
        (err, stdout) => {
          if (err) return reject(new Error("No folder selected"));
          resolve(stdout.trim());
        }
      );
    } else {
      // Linux: zenity
      exec("zenity --file-selection --directory", (err, stdout) => {
        if (err) return reject(new Error("No folder selected"));
        resolve(stdout.trim());
      });
    }
  });
}

// ---- Main loop ----
async function main() {
  while (true) {
    try {
      const msg = await readMessage();
      await handleCommand(msg);
    } catch (err) {
      // stdin closed = Chrome disconnected
      if (err.code === "ERR_STREAM_DESTROYED" || err.message.includes("EOF")) break;
      sendMessage({ id: null, type: "error", message: err.message });
    }
  }
}

main();
