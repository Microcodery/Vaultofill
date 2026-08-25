// VERIFY-AGAINST-INSTALLED: MV3 manifest keys (`side_panel` vs Firefox's
// `sidebar_action`, `background.service_worker` vs Firefox's still-MV2-style
// background page in some versions, `host_permissions` syntax) are version-
// and browser-specific. These objects are a starting point for the build
// step to write out as manifest.json for each target — verify against the
// installed Chrome and Firefox before shipping.

interface ManifestBase {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  host_permissions: string[];
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at: "document_idle";
  }>;
  action: {
    default_title: string;
  };
  commands: {
    "open-panel": {
      suggested_key: { default: string };
      description: string;
    };
  };
  content_security_policy: {
    extension_pages: string;
  };
}

export interface ChromeManifest extends ManifestBase {
  permissions: string[];
  background: {
    service_worker: string;
    type: "module";
  };
  side_panel: {
    default_path: string;
  };
}

export interface FirefoxManifest extends ManifestBase {
  permissions: string[];
  background: {
    scripts: string[];
    type: "module";
  };
  sidebar_action: {
    default_panel: string;
    default_title: string;
  };
  browser_specific_settings: {
    gecko: {
      id: string;
    };
  };
}

const base: ManifestBase = {
  manifest_version: 3,
  name: "Vaultofill",
  version: "1.0.0",
  description: "Fills web forms from natural-language requests.",
  // <all_urls> covers arbitrary form pages; the HuggingFace hosts are listed
  // explicitly too since some browsers/reviewers special-case wildcard grants
  // — they're where web-llm's on-device model weights are downloaded from (the
  // model-lib wasm loads from raw.githubusercontent.com, which <all_urls> covers).
  host_permissions: [
    "<all_urls>",
    "https://huggingface.co/*",
    "https://*.hf.co/*",
    "https://cdn-lfs.huggingface.co/*",
  ],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["content/contentScript.js"],
      run_at: "document_idle",
    },
  ],
  action: {
    default_title: "Vaultofill",
  },
  // A keyboard shortcut is a reliable way to open the side panel (its onCommand
  // carries user activation, unlike a content-script click).
  commands: {
    "open-panel": {
      suggested_key: { default: "Alt+Shift+F" },
      description: "Autofill the current page with Vaultofill",
    },
  },
  // 'wasm-unsafe-eval' is required to compile/instantiate web-llm's WASM
  // (TVM runtime + model-lib) for on-device inference from extension pages.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
};

export const chromeManifest: ChromeManifest = {
  ...base,
  // "sidePanel" is required for chrome.sidePanel.* (both setPanelBehavior and
  // open()); "offscreen" for chrome.offscreen.* (the background document that
  // hosts the on-device WebGPU model). Both are Chrome-only.
  permissions: ["storage", "activeTab", "scripting", "tabs", "sidePanel", "offscreen", "contextMenus", "nativeMessaging"],
  background: {
    service_worker: "background.js",
    type: "module",
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
};

export const firefoxManifest: FirefoxManifest = {
  ...base,
  // Firefox has no sidePanel permission/API; it uses sidebar_action instead.
  permissions: ["storage", "activeTab", "scripting", "tabs", "contextMenus", "nativeMessaging"],
  // Firefox does not support MV3 service workers — it requires the
  // event-page-style `scripts` background key instead.
  background: {
    scripts: ["background.js"],
    type: "module",
  },
  sidebar_action: {
    default_panel: "sidepanel.html",
    default_title: "Vaultofill",
  },
  browser_specific_settings: {
    gecko: {
      id: "vaultofill@riys.dev",
    },
  },
};
