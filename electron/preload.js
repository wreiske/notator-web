const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  /** Whether the app is running inside Electron */
  isElectron: true,

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
});
