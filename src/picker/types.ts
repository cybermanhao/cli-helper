/**
 * Shared types between the Node.js server (index.ts) and the browser picker (picker.ts).
 * The server serialises PickerConfig as JSON and injects it into the HTML page;
 * the browser deserialises it from window.__PICKER_CONFIG__.
 */

export interface AssetPickerItem {
  label: string;
  /** Absolute local path — the server proxies it via /picker-image?path=... */
  imagePath: string;
  metadata?: Record<string, string>;
}

export interface PickerConfig {
  sessionId: string;
  multiSelect: boolean;
  allowUpload: boolean;
  items: AssetPickerItem[];
}
