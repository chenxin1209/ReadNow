const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
  logo: {
    fill: "currentColor",
    stroke: "none",
    transform: "translate(-2.2 0)",
    paths: [
      "M5.4 4.1c0-.7.6-1.2 1.2-1.1 2.9.5 5.3 1.7 7.4 3.6 2.1-1.9 4.5-3.1 7.4-3.6.7-.1 1.3.4 1.3 1.1v13.2c0 .6-.4 1-1 1.1-2.8.4-5.2 1.5-7.1 3.2-.4.3-.9.3-1.2 0-1.9-1.7-4.3-2.8-7.1-3.2-.6-.1-.9-.5-.9-1.1V4.1Z",
      "M12 7.1v13.1",
    ],
  },
  spark: {
    fill: "currentColor",
    stroke: "none",
    paths: [
      "M12 2.6l1.7 5.4c.2.6.7 1.1 1.3 1.3l5.4 1.7-5.4 1.7c-.6.2-1.1.7-1.3 1.3L12 19.4l-1.7-5.4c-.2-.6-.7-1.1-1.3-1.3L3.6 11l5.4-1.7c.6-.2 1.1-.7 1.3-1.3L12 2.6Z",
      "M19.2 16.2l.7 2.1c.1.3.3.5.6.6l2.1.7-2.1.7c-.3.1-.5.3-.6.6l-.7 2.1-.7-2.1c-.1-.3-.3-.5-.6-.6l-2.1-.7 2.1-.7c.3-.1.5-.3.6-.6l.7-2.1Z",
    ],
  },
  settings: {
    paths: [
      "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z",
      "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.6 2.6-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-3.6v-.2a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.9 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3.5v-3.6h.2a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9L4.9 7.4 7.5 4.8l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10.6 3.6v-.2h3.6v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.6 2.6-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v3.6h-.2a1.7 1.7 0 0 0-1.6 1Z",
    ],
  },
  close: { paths: ["M6 6l12 12", "M18 6L6 18"] },
  send: { paths: ["M21 3L10.2 13.8", "M21 3l-6.8 18-4-8.2L2 9.8 21 3Z"] },
  stop: { paths: ["M7 7h10v10H7z"] },
  trash: { paths: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 14h10l1-14", "M10 11v6", "M14 11v6"] },
  history: { paths: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 3v5h5", "M12 7v5l3 2"] },
  pin: { paths: ["M9 3h6l-1 6 3 3v2h-5v7l-1 1-1-1v-7H5v-2l3-3-1-6Z"] },
  translate: {
    paths: [
      "M4 5h9",
      "M8.5 5c0 4.2-2 7.3-5 9",
      "M6 9.2c1.3 1.8 3 3.2 5 4",
      "M13 19l4-10 4 10",
      "M14.4 15.6h5.2",
    ],
  },
  download: { paths: ["M12 3v12", "M7 10l5 5 5-5", "M4 19h16"] },
  expand: { paths: ["M8 3H3v5", "M16 3h5v5", "M8 21H3v-5", "M16 21h5v-5"] },
  copy: {
    paths: [
      "M9 9h10v10H9z",
      "M5 15H4V4h10v1",
    ],
  },
  chevronLeft: { paths: ["M15 5l-7 7 7 7"] },
  chevronRight: { paths: ["M9 5l7 7-7 7"] },
  check: { paths: ["M4 12l5 5L20 6"] },
  alert: { paths: ["M12 3l9 17H3L12 3Z", "M12 9v5", "M12 17h.01"] },
  quote: {
    fill: "currentColor",
    stroke: "none",
    paths: [
      "M9.5 6C6.5 7.3 5 9.6 5 12.8V18h6v-5.5H8.2c0-2 .7-3.4 2.4-4.3L9.5 6Zm9 0c-3 1.3-4.5 3.6-4.5 6.8V18h6v-5.5h-2.8c0-2 .7-3.4 2.4-4.3L18.5 6Z",
    ],
  },
  panel: { paths: ["M3 4h18v16H3z", "M15 4v16"] },
  refresh: { paths: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"] },
  external: { paths: ["M14 3h7v7", "M21 3l-9 9", "M19 14v5H5V5h5"] },
  more: { paths: ["M5 12h.01", "M12 12h.01", "M19 12h.01"] },
  drag: { paths: ["M9 6h.01", "M15 6h.01", "M9 12h.01", "M15 12h.01", "M9 18h.01", "M15 18h.01"] },
  bookOpen: {
    paths: [
      "M3 5.5c3.3-.6 6 .4 9 2.7 3-2.3 5.7-3.3 9-2.7v13c-3.3-.6-6 .4-9 2.7-3-2.3-5.7-3.3-9-2.7v-13Z",
      "M12 8.2v13",
    ],
  },
  arrowRight: { paths: ["M4 12h16", "M14 6l6 6-6 6"] },
  key: { paths: ["M14.5 9.5a4.5 4.5 0 1 1-4-4.4", "M14.5 9.5L21 3", "M17 6l2 2", "M19 4l2 2"] },
  info: {
    paths: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 10.5V17", "M12 7.5h.01"],
  },
  wand: { paths: ["M4 20L16 8", "M14 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z", "M19 13l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6.6-1.8Z"] },
};

export function icon(doc, name, size = 18) {
  const definition = ICONS[name] || ICONS.spark;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("dr-icon");
  if (definition.fill) svg.setAttribute("fill", definition.fill);
  else svg.setAttribute("fill", "none");
  if (definition.stroke !== "none") {
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", name === "settings" ? "1.5" : "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  const target = definition.transform
    ? doc.createElementNS(SVG_NS, "g")
    : svg;
  if (definition.transform) target.setAttribute("transform", definition.transform);
  for (const pathData of definition.paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    if (definition.stroke === "none") path.setAttribute("fill", "currentColor");
    target.appendChild(path);
  }
  if (target !== svg) svg.appendChild(target);
  return svg;
}

export function brandMark(doc, size = 26) {
  const wrapper = doc.createElement("span");
  wrapper.className = "dr-brand-mark";
  wrapper.appendChild(icon(doc, "logo", size));
  return wrapper;
}
