const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /** Whether the app is running inside Electron */
  isElectron: true,

  /** The OS platform: 'darwin', 'win32', or 'linux' */
  platform: process.platform,

  /**
   * Open a native file dialog filtered to .SON files.
   * @returns {{ buffer: ArrayBuffer, filename: string } | null}
   */
  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),

  /**
   * Get the app version from package.json.
   * @returns {string}
   */
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  /** Minimize the window */
  minimizeWindow: () => ipcRenderer.invoke("window-minimize"),

  /** Maximize/restore the window */
  maximizeWindow: () => ipcRenderer.invoke("window-maximize"),

  /** Close the window */
  closeWindow: () => ipcRenderer.invoke("window-close"),
});
