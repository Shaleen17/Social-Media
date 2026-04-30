(function initSearchEnhancer(global) {
  "use strict";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clear() {
    global.document.getElementById("tsSearchAssist")?.remove();
  }

  function applySuggestion(value, type) {
    const safeValue = String(value || "").trim();
    if (!safeValue) return;

    const input = global.document.getElementById("srchIn");
    if (input) {
      input.value =
        type === "user" ? safeValue.replace(/^@+/, "") : safeValue;
    }

    const peopleTab = global.document.querySelector('#srchTabs .tab:nth-child(1)');
    const postsTab = global.document.querySelector('#srchTabs .tab:nth-child(2)');
    const tagsTab = global.document.querySelector('#srchTabs .tab:nth-child(3)');
    let tabHandled = false;

    if (type === "user" && typeof global.setSTab === "function") {
      global.setSTab("people", peopleTab);
      tabHandled = true;
    } else if (type === "hashtag" && typeof global.setSTab === "function") {
      global.setSTab("tags", tagsTab);
      tabHandled = true;
    } else if (typeof global.setSTab === "function") {
      global.setSTab("posts", postsTab);
      tabHandled = true;
    }

    if (!tabHandled && typeof global.doSearch === "function") {
      global.doSearch(input?.value || safeValue);
    }
  }

  function render(result, query) {
    clear();

    const container = global.document.getElementById("srchResults");
    if (!container) return;

    const safeQuery = String(query || "").trim();
    const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
    const correction = String(result?.correction || "").trim();
    if (!safeQuery || (!suggestions.length && !correction)) return;

    const wrapper = global.document.createElement("div");
    wrapper.id = "tsSearchAssist";
    wrapper.style.padding = "14px 16px 8px";
    wrapper.style.borderBottom = "1px solid var(--bd)";
    wrapper.style.background = "var(--card)";

    const chips = suggestions
      .map(
        (item) =>
          `<button class="btn btn-w btn-sm" style="margin:0 8px 8px 0" onclick='TSSearchEnhancer.applySuggestion(${JSON.stringify(
            item.value
          )}, ${JSON.stringify(item.type)})'>${escapeHtml(item.label)}${
            item.meta ? ` <span style="opacity:.65">${escapeHtml(item.meta)}</span>` : ""
          }</button>`
      )
      .join("");

    wrapper.innerHTML = `
      ${
        correction
          ? `<div style="font-size:13px;color:var(--t2);margin-bottom:10px">Did you mean <button class="btn btn-p btn-sm" style="margin-left:6px" onclick='TSSearchEnhancer.applySuggestion(${JSON.stringify(
              correction
            )}, "post")'>${escapeHtml(correction)}</button>?</div>`
          : ""
      }
      ${
        chips
          ? `<div style="display:flex;flex-wrap:wrap;align-items:center"><span style="font-size:12px;font-weight:700;color:var(--t3);margin-right:10px;text-transform:uppercase;letter-spacing:.04em">Suggestions</span>${chips}</div>`
          : ""
      }
    `;

    container.insertBefore(wrapper, container.firstChild);
  }

  global.TSSearchEnhancer = {
    applySuggestion,
    clear,
    render,
  };
})(window);
