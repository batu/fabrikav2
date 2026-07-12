// Smallest recorded plugin path for goal R3 (live copy preview while typing).
//
// Finding: Phaser Editor 5.0.2 inspector string fields commit only on the
// native "change" event (blur/Enter) — see createStringField /
// createStringDialogField in the scene plugin — so the canvas does not update
// per keystroke. This plugin forwards every "input" event on an inspector
// text field as an immediate "change", which routes each keystroke through
// the editor's own undo-manager commit path and repaints the scene live.
//
// Probe-scoped: acceptable cost is one undo step per keystroke. Loaded via
// the server's documented `-plugins` flag; no editor source is modified.
(function () {
    window.__liveCopyPreviewPluginLoaded = true;
    document.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
            return;
        }
        // Only forward fields rendered by the editor's form builder (they all
        // carry the formText class); leaves filter/search boxes alone.
        if (!target.classList.contains("formText")) {
            return;
        }
        target.dispatchEvent(new Event("change", { bubbles: false }));
    });
})();
