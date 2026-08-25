/** browser.storage-shaped key/value area (chrome.storage.local or a test fake). */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(obj: Record<string, unknown>): Promise<void>;
}
