// Event bus to break cycles between renderers, state mutators, and main.
// main.js calls setRerender / setRegionToolbarRenderer at boot;
// everyone else imports the no-arg trigger functions and calls them.
let _rerender = () => {};
export function setRerender(fn) { _rerender = fn; }
export function rerender() { _rerender(); }

let _renderRegionToolbar = () => {};
export function setRegionToolbarRenderer(fn) { _renderRegionToolbar = fn; }
export function renderRegionToolbar() { _renderRegionToolbar(); }
