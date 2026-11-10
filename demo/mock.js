(async function () {
  "use strict";
  const app = window.Zotero.DeepRead;
  await app.init({
    id: "deepread@zotero.local",
    version: "0.1.0",
    rootURI: "file:///mock/",
  });

  const reader = window.__mockReader;
  const listeners = window.__readerListeners;
  const toolbarSlot = document.getElementById("toolbar-slot");
  const appendToolbar = (...elements) => elements.forEach((element) => toolbarSlot.append(element));
  listeners.renderToolbar({ reader, doc: document, params: {}, append: appendToolbar });

  document.getElementById("deepread-toolbar-button").click();
  await window.Zotero.Promise?.delay?.(10);
  await new Promise((resolve) => setTimeout(resolve, 900));

  if (new URLSearchParams(window.location.search).has("setup")) return;

  const popupSlot = document.getElementById("popup-slot");
  const appendPopup = (...elements) => elements.forEach((element) => popupSlot.append(element));
  const selection = {
    text:
      "Recurrent models typically factor computation along the symbol positions of the input and output sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden states h_t, as a function of the previous hidden state h_{t-1} and the input for position t.",
    pageIndex: 0,
    pageLabel: "1",
    position: { pageIndex: 0, rects: [[64, 286, 534, 354]] },
    color: "#ffd400",
  };
  listeners.renderTextSelectionPopup({
    reader,
    doc: document,
    params: {
      annotation: selection,
      rect: { x: 300, y: 520, width: 470, height: 68 },
    },
    append: appendPopup,
  });

  await new Promise((resolve) => setTimeout(resolve, 700));
  const askButton = document.querySelector(".dr-selection-ask");
  askButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const input = document.querySelector(".dr-card-input");
  if (input) {
    input.value = "为什么说循环结构会限制训练时的并行化？";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".dr-card .dr-send")?.click();
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  document.getElementById("popup-slot").innerHTML = "";
})();
