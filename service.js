/**
 * service.js
 *
 * Background service worker (MV3). It makes the toolbar icon open the side
 * panel (sidepanel.html) and listens for the `reload` keyboard command declared
 * in manifest.json to reload the extension, which is handy while developing an
 * unpacked build.
 */

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("Failed to set side panel behavior:", error));

chrome.commands.onCommand.addListener((shortcut) => {
    if (shortcut === 'reload') {
        console.log("reloading extension");
        chrome.runtime.reload();
    }
});