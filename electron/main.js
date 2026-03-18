const { app, BrowserWindow, dialog, ipcMain, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");

// Keep a global reference to prevent garbage collection
let mainWindow;

// Register custom scheme as privileged BEFORE app is ready.
// This enables localStorage, sessionStorage, cookies, and fetch under notator://
protocol.registerSchemesAsPrivileged([
  {
    scheme: "notator",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function createWindow() {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Notator",
    backgroundColor: "#0a0a0f",
    // Frameless window: macOS uses hiddenInset for native traffic lights,
    // Windows/Linux uses frame: false for fully custom title bar
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 12, y: 10 },
        }
      : {
          frame: false,
        }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load via custom protocol so absolute paths (/_next/static/...) resolve correctly
  mainWindow.loadURL("notator://app/");

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Register custom protocol to serve static files (avoids file:// CORS issues)
app.whenReady().then(() => {
  const outDir = path.join(__dirname, "..", "out");

  protocol.handle("notator", (request) => {
    const requestUrl = new URL(request.url);
    // Decode percent-encoded characters
    let pathname = decodeURIComponent(requestUrl.pathname);
    // Remove leading slash for path.join
    if (pathname.startsWith("/")) pathname = pathname.slice(1);
    // Default to index.html for root
    if (!pathname) pathname = "index.html";

    let filePath = path.normalize(path.join(outDir, pathname));

    // Security: ensure we don't serve files outside of out/
    if (!filePath.startsWith(outDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Next.js static export creates both "community.html" and "community/" (for RSC data).
    // Prioritize the .html file for page navigation requests.
    if (!path.extname(filePath)) {
      const withHtml = filePath + ".html";
      if (fs.existsSync(withHtml)) {
        filePath = withHtml;
      } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        // Only fall back to directory/index.html if no .html file exists
        const indexFile = path.join(filePath, "index.html");
        if (fs.existsSync(indexFile)) {
          filePath = indexFile;
        }
      }
    }

    return net.fetch(require("url").pathToFileURL(filePath).toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ─── IPC Handlers ───

// Native file open dialog for .SON files
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open .SON File",
    filters: [
      { name: "Notator Song Files", extensions: ["son", "SON"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);

  return {
    buffer: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
    filename,
  };
});

// Get app version
ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

// Window control handlers (for custom title bar)
ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window-close", () => {
  mainWindow?.close();
});

// Quit when all windows are closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
