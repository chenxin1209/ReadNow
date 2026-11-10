/* ReadNow for Zotero — bootstrap entry point. */
"use strict";

var DeepRead;
var chromeHandle;

function debug(message) {
  try {
    Zotero.debug(`ReadNow bootstrap: ${message}`);
  } catch (_) {
    // Zotero may not be available during early startup.
  }
}

function writeStartupError(error) {
  try {
    const path = PathUtils.join(Zotero.Profile.dir, "deepread-startup-error.log");
    const text = `${new Date().toISOString()}\n${error?.stack || error}\n`;
    IOUtils.write(path, new TextEncoder().encode(text));
  } catch (_) {
    // Never mask the original startup error.
  }
}

function install() {}

function uninstall() {}

async function startup({ id, version, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  await Zotero.initializationPromise;

  try {
    const aomStartup = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    const manifestURI = Services.io.newURI(`${rootURI}manifest.json`);
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "deepread", `${rootURI}content/`],
    ]);
  } catch (error) {
    debug(`chrome registration failed: ${error}`);
    throw error;
  }

  try {
    Services.scriptloader.loadSubScript(`${rootURI}content/scripts/deepread.js`, this);
    DeepRead = Zotero.DeepRead;
    if (!DeepRead) throw new Error("ReadNow bundle did not expose its internal Zotero API");
    await DeepRead.init({ id, version, rootURI });
  } catch (error) {
    debug(`startup failed: ${error}`);
    writeStartupError(error);
    Zotero.logError(error);
    throw error;
  }
}

async function shutdown({ id, version, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  try {
    if (DeepRead) await DeepRead.shutdown();
  } catch (error) {
    debug(`shutdown failed: ${error}`);
    Zotero.logError(error);
  }
  DeepRead = undefined;
  if (chromeHandle) {
    try {
      chromeHandle.destruct();
    } catch (error) {
      debug(`chrome destruct failed: ${error}`);
    }
    chromeHandle = null;
  }
}

function onMainWindowLoad({ window }) {
  try {
    DeepRead?.addToolsMenu();
  } catch (error) {
    debug(`onMainWindowLoad failed: ${error}`);
  }
}

function onMainWindowUnload({ window }) {
  try {
    DeepRead?.removeToolsMenuForWindow?.(window);
  } catch (error) {
    debug(`onMainWindowUnload failed: ${error}`);
  }
}
