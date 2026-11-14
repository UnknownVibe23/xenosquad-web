/*
 * ui/dom.js — tiny DOM builder helper.
 *
 * WHY: the UI modules only render; they never keep logic state. `h()` builds
 * elements from a plain spec so render functions stay declarative and there
 * are no inline event handlers in index.html (the CSP forbids them) — event
 * listeners are attached here via the `on` attribute key instead.
 */
(function (root, factory) {
  const XS = (root.XS = root.XS || {});
  const api = factory(XS);
  XS.dom = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const val = attrs[key];
        if (val == null || val === false) continue;
        if (key === "on") {
          for (const evt of Object.keys(val)) el.addEventListener(evt, val[evt]);
        } else if (key === "class") {
          el.className = val;
        } else if (key === "text") {
          el.textContent = val;
        } else if (key === "value") {
          el.value = val;
        } else if (key === "checked") {
          el.checked = !!val;
        } else if (key === "disabled") {
          el.disabled = !!val;
        } else {
          el.setAttribute(key, val === true ? "" : String(val));
        }
      }
    }
    if (children != null) {
      for (const child of Array.isArray(children) ? children : [children]) {
        if (child == null || child === false) continue;
        el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
      }
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  return { h, clear };
});
