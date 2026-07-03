const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const APP_NAME = "DeSonKuPik";
const PUBLISHER = "SonKuPik";
const DEV_SERVER_URL = "http://127.0.0.1:5173";

let mainWindow = null;

function isDevMode() {
  return !app.isPackaged;
}

function resolveWindowIcon() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(__dirname, "..", "build", "icon.png");
}

function inferMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".wav":
      return "audio/wav";
    case ".mp3":
      return "audio/mpeg";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function sanitizeFileName(name) {
  return String(name || "desonkupik-export")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: `${APP_NAME} — Offline Audio Mastering`,
    icon: resolveWindowIcon(),
    backgroundColor: "#080813",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isLocalFile = url.startsWith("file://");
    const isDevUrl = isDevMode() && url.startsWith(DEV_SERVER_URL);
    if (!isLocalFile && !isDevUrl) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (isDevMode()) {
    await mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function sendMenuCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop:menu-command", command);
}

function buildMenu() {
  const isMac = process.platform === "darwin";

  // On Windows/Linux production, keep the desktop app visually identical to the web UI.
  // The web app already has its own header/menu, so the native Electron menu is hidden.
  if (!isMac && app.isPackaged) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { label: `About ${APP_NAME}`, click: () => sendMenuCommand("about") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Audio…",
          accelerator: "CmdOrCtrl+O",
          click: () => sendMenuCommand("open-audio"),
        },
        { type: "separator" },
        {
          label: "Export WAV (mastered)…",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => sendMenuCommand("export-wav"),
        },
        {
          label: "Export MP3 320 kbps…",
          accelerator: "CmdOrCtrl+Shift+M",
          click: () => sendMenuCommand("export-mp3"),
        },
        { type: "separator" },
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+N",
          click: () => sendMenuCommand("new-session"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(isDevMode() ? [{ role: "toggleDevTools" }] : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Quick Guide", click: () => sendMenuCommand("help") },
        { label: `About ${APP_NAME}`, click: () => sendMenuCommand("about") },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId("com.sonkupik.desonkupik");
}

app.whenReady().then(async () => {
  buildMenu();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("desktop:open-audio", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open audio file",
    properties: ["openFile"],
    filters: [
      { name: "Audio", extensions: ["wav", "mp3", "flac", "ogg", "m4a", "aac"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const bytes = await fs.readFile(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    type: inferMime(filePath),
    bytes,
  };
});

ipcMain.handle("desktop:open-settings", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import DeSonKuPik settings",
    properties: ["openFile"],
    filters: [
      { name: "DeSonKuPik Settings", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const bytes = await fs.readFile(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    type: "application/json",
    bytes,
  };
});

ipcMain.handle("desktop:save-file", async (_event, payload) => {
  if (!mainWindow) return { canceled: true };
  const defaultName = sanitizeFileName(payload?.defaultName);
  const kind = payload?.kind || "binary";
  const filters =
    kind === "wav"
      ? [{ name: "WAV Audio", extensions: ["wav"] }]
      : kind === "mp3"
        ? [{ name: "MP3 Audio", extensions: ["mp3"] }]
        : kind === "json"
          ? [{ name: "JSON Settings", extensions: ["json"] }]
          : [{ name: "All Files", extensions: ["*"] }];

  const result = await dialog.showSaveDialog(mainWindow, {
    title: kind === "json" ? "Export DeSonKuPik settings" : "Export mastered audio",
    defaultPath: defaultName,
    filters,
  });

  if (result.canceled || !result.filePath) return { canceled: true };

  const inputBytes = payload?.bytes;
  const buffer = Buffer.isBuffer(inputBytes)
    ? inputBytes
    : inputBytes instanceof Uint8Array
      ? Buffer.from(inputBytes)
      : Buffer.from(inputBytes || []);

  await fs.writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});
