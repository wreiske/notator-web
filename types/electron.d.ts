/**
 * Type declarations for the Electron preload API.
 * Only available when the app runs inside Electron.
 */

interface ElectronAPI {
  /** Whether the app is running inside Electron */
  isElectron: boolean;

  /** The OS platform: 'darwin', 'win32', or 'linux' */
  platform: string;

  /** Open a native file dialog filtered to .SON files */
  openFileDialog(): Promise<{
    buffer: ArrayBuffer;
    filename: string;
  } | null>;

  /** Get the app version from package.json */
  getAppVersion(): Promise<string>;

  /** Minimize the window */
  minimizeWindow(): Promise<void>;

  /** Maximize/restore the window */
  maximizeWindow(): Promise<void>;

  /** Close the window */
  closeWindow(): Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
