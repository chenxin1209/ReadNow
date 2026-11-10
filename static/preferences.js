/* ReadNow preferences pane bootstrap. The actual UI lives in the plugin
   bundle so preferences and the reader share one implementation. */
(function () {
  "use strict";

  window.__deepreadPrefsScriptLoaded = true;
  var attempts = 0;

  function mount() {
    attempts += 1;
    try {
      var root = document.getElementById("deepread-prefs-root");
      var provider = document.getElementById("dr-pref-provider");
      if ((!root || !provider) && attempts < 40) {
        window.setTimeout(mount, 50);
        return;
      }
      if (typeof Zotero !== "undefined" && Zotero.DeepRead && typeof Zotero.DeepRead.mountPreferences === "function") {
        Zotero.DeepRead.mountPreferences(document);
        window.__deepreadPrefsMounted = true;
      } else {
        window.__deepreadPrefsError = "ReadNow internal API is unavailable";
      }
    } catch (error) {
      window.__deepreadPrefsError = String(error?.stack || error);
      Zotero.logError(error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
