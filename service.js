/**
 * service.js
 *
 * Background service worker (MV3). Its only job is to listen for the `reload`
 * keyboard command declared in manifest.json and reload the extension, which is
 * handy while developing an unpacked build.
 */

chrome.commands.onCommand.addListener((shortcut) => {
    if (shortcut === 'reload') {
        console.log("reloading extension");
        chrome.runtime.reload();
    }
});