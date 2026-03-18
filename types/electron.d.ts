/**
 * Type declarations for the Electron preload API.
 * Only available when the app runs inside Electron.
 */

interface ElectronAPI {
  /** Whether the app is running inside Electron */
  isElectron: boolean;

  /** Open a native file dialog filtered to .SON files */
  openFileDialog(): Promise<{
    buffer: ArrayBuffer;
    filename: string;
  } | null>;

  /** Get the app version from package.json */
  getAppVersion(): Promise<string>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
