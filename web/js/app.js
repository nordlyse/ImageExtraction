const themeLightButton = document.getElementById("theme-light-button");
const themeDarkButton = document.getElementById("theme-dark-button");
const pieceMenu = document.getElementById("piece-menu");
const copyButton = document.getElementById("copy-piece");
const pasteButton = document.getElementById("paste-piece");
const moveButton = document.getElementById("move-piece");
const enlargeButton = document.getElementById("enlarge-piece");
const shrinkButton = document.getElementById("shrink-piece");
const rotateLeftButton = document.getElementById("rotate-left");
const rotateRightButton = document.getElementById("rotate-right");
const deleteButton = document.getElementById("delete-piece");
const THEME_KEY = "image-extraction-theme";

const panes = [
  {
    id: "left",
    frame: "left-frame",
    canvas: "left-canvas",
    placeholder: "left-placeholder",
    save: "left-save",
    button: "left-open",
    input: "left-file",
    status: "left-status",
  },
  {
    id: "right",
    frame: "right-frame",
    canvas: "right-canvas",
    placeholder: "right-placeholder",
    save: "right-save",
    button: "right-open",
    input: "right-file",
    status: "right-status",
  },
].map((pane) => ({
  ...pane,
  node: {},
  base: null,
  pieces: [],
  point: null,
  hover: null,
  splitting: false,
  fileName: "",
  moving: null,
  token: 0,
}));

let clipboard = null;
let menuPane = null;
let menuPoint = null;

function bindSpotlight(card) {
  if (!card) {
    return;
  }
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  });
}

function showCanvas(canvas, placeholder) {
  canvas.hidden = false;
  placeholder.hidden = true;
  placeholder.classList.add("is-off");
}

function readPhoto(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() =>
      createImageBitmap(file)
    );
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("read failed"));
    };
    image.src = url;
  });
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height,
  };
}

function rememberBase(canvas) {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  return copy;
}

function paintView(state) {
  const canvas = state.node.canvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.base) {
    ctx.drawImage(state.base, 0, 0);
  }
  for (const piece of state.pieces) {
    if (piece.floating) {
      ctx.drawImage(piece.image, piece.x, piece.y);
    }
  }
  const hover = state.hover;
  if (!hover) {
    return;
  }
  ctx.strokeStyle = "#c4454d";
  ctx.lineWidth = Math.max(2, canvas.width / 400);
  ctx.strokeRect(hover.x + 1, hover.y + 1, Math.max(1, hover.width - 2), Math.max(1, hover.height - 2));
}

function alphaAt(piece, x, y) {
  const localX = Math.floor(x - piece.x);
  const localY = Math.floor(y - piece.y);
  if (localX < 0 || localY < 0 || localX >= piece.width || localY >= piece.height) {
    return 0;
  }
  return piece.data[(localY * piece.width + localX) * 4 + 3];
}

function pieceAt(state, point) {
  for (let index = state.pieces.length - 1; index >= 0; index -= 1) {
    const piece = state.pieces[index];
    if (piece.floating && alphaAt(piece, point.x, point.y) >= 16) {
      return piece;
    }
  }
  let best = null;
  let bestArea = Infinity;
  let boxBest = null;
  let boxArea = Infinity;
  for (const piece of state.pieces) {
    if (piece.floating) {
      continue;
    }
    const inside =
      point.x >= piece.x &&
      point.y >= piece.y &&
      point.x < piece.x + piece.width &&
      point.y < piece.y + piece.height;
    if (!inside) {
      continue;
    }
    const area = piece.width * piece.height;
    if (area < boxArea) {
      boxBest = piece;
      boxArea = area;
    }
    if (alphaAt(piece, point.x, point.y) >= 16 && area < bestArea) {
      best = piece;
      bestArea = area;
    }
  }
  return best || boxBest;
}

function loadPiece(raw) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scratch = document.createElement("canvas");
      scratch.width = image.width;
      scratch.height = image.height;
      const ctx = scratch.getContext("2d");
      ctx.drawImage(image, 0, 0);
      resolve({
        x: raw.x,
        y: raw.y,
        width: image.width,
        height: image.height,
        image,
        data: ctx.getImageData(0, 0, image.width, image.height).data,
      });
    };
    image.onerror = () => reject(new Error("piece"));
    image.src = `data:image/png;base64,${raw.png}`;
  });
}

let menuShownAt = 0;
let drag = null;
let skipClick = false;

function hideMenu() {
  pieceMenu.hidden = true;
  menuPane = null;
  menuPoint = null;
}

function showMenu(event, state, point) {
  menuShownAt = performance.now();
  menuPane = state;
  menuPoint = point;
  state.moving = null;
  state.hover = pieceAt(state, point);
  paintView(state);
  const noPiece = !state.hover;
  copyButton.disabled = noPiece;
  pasteButton.disabled = !clipboard;
  moveButton.disabled = noPiece;
  enlargeButton.disabled = noPiece;
  shrinkButton.disabled = noPiece;
  rotateLeftButton.disabled = noPiece;
  rotateRightButton.disabled = noPiece;
  deleteButton.disabled = noPiece;
  if (noPiece) {
    state.node.status.textContent = state.splitting
      ? "Still splitting. Copy, Move, Enlarge, Shrink, Rotate, and Delete turn on when the piece count appears."
      : "Right-click the object itself to copy, move, resize, rotate, or delete it.";
  }
  pieceMenu.hidden = false;
  const margin = 8;
  const width = pieceMenu.offsetWidth;
  const height = pieceMenu.offsetHeight;
  const left = Math.min(event.clientX, window.innerWidth - width - margin);
  const top = Math.min(event.clientY, window.innerHeight - height - margin);
  pieceMenu.style.left = `${Math.max(margin, left)}px`;
  pieceMenu.style.top = `${Math.max(margin, top)}px`;
}

function endSplit(state, token, text) {
  if (token !== state.token) {
    return;
  }
  state.splitting = false;
  state.node.status.textContent = text;
}

async function splitPane(state) {
  const token = state.token + 1;
  state.token = token;
  state.pieces = state.pieces.filter((piece) => piece.floating);
  state.hover = state.hover && state.hover.floating ? state.hover : null;
  state.splitting = true;
  paintView(state);
  state.node.status.textContent = "Splitting image...";
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      state.node.canvas.toBlob((value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error("blob"));
        }
      }, "image/png");
    });
  } catch (error) {
    endSplit(state, token, "Could not split this image.");
    return;
  }
  if (token !== state.token) {
    return;
  }
  let response;
  try {
    response = await fetch("/api/segment", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: blob,
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    endSplit(
      state,
      token,
      error.name === "TimeoutError" ? "Split took too long. Try a smaller photo." : "SAM is not ready yet."
    );
    return;
  }
  if (token !== state.token) {
    return;
  }
  if (!response.ok) {
    endSplit(state, token, response.status === 503 ? "SAM is still loading." : "Could not split this image.");
    return;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    endSplit(state, token, "Could not split this image.");
    return;
  }
  const loaded = [];
  for (const raw of payload.pieces || []) {
    try {
      loaded.push(await loadPiece(raw));
    } catch (error) {
      continue;
    }
  }
  if (token !== state.token) {
    return;
  }
  const floating = state.pieces.filter((piece) => piece.floating);
  state.pieces = loaded.concat(floating);
  endSplit(state, token, `Image open. ${loaded.length} pieces.`);
}

function deletePiece(state) {
  const piece = state.hover;
  if (!piece || !state.base) {
    return;
  }
  if (!piece.floating) {
    const ctx = state.base.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(piece.image, piece.x, piece.y);
    ctx.restore();
  }
  state.pieces = state.pieces.filter((item) => item !== piece);
  if (state.moving === piece) {
    state.moving = null;
  }
  state.hover = null;
  paintView(state);
  state.node.status.textContent = "Deleted.";
}

const RESIZE_STEP = 1.25;
const TURN_STEP = 15;

function renderPiece(source, sourceWidth, sourceHeight, angle, centerX, centerY) {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = Math.max(1, Math.ceil(sourceWidth * cos + sourceHeight * sin));
  const height = Math.max(1, Math.ceil(sourceWidth * sin + sourceHeight * cos));
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width,
    height,
    image: scratch,
    data: ctx.getImageData(0, 0, width, height).data,
    floating: true,
    source,
    sourceWidth,
    sourceHeight,
    angle,
  };
}

function placeNext(state, piece, next) {
  if (piece.floating) {
    const index = state.pieces.indexOf(piece);
    if (index >= 0) {
      state.pieces[index] = next;
    } else {
      state.pieces.push(next);
    }
    if (clipboard === piece) {
      clipboard = next;
    }
    if (state.moving === piece) {
      state.moving = next;
    }
    if (drag && drag.piece === piece) {
      drag.piece = next;
    }
  } else {
    state.pieces.push(next);
  }
  state.hover = next;
  paintView(state);
}

function resizePiece(state, factor) {
  const piece = state.hover;
  if (!piece || !state.base) {
    return;
  }
  const source = piece.source || piece.image;
  const sourceWidth = Math.round((piece.sourceWidth || piece.width) * factor);
  const sourceHeight = Math.round((piece.sourceHeight || piece.height) * factor);
  const limit = Math.max(state.node.canvas.width, state.node.canvas.height) * 3;
  if (sourceWidth < 8 || sourceHeight < 8) {
    state.node.status.textContent = "That piece is already small.";
    return;
  }
  if (sourceWidth > limit || sourceHeight > limit) {
    state.node.status.textContent = "That piece is already large.";
    return;
  }
  const next = renderPiece(
    source,
    sourceWidth,
    sourceHeight,
    piece.angle || 0,
    piece.x + piece.width / 2,
    piece.y + piece.height / 2
  );
  placeNext(state, piece, next);
  state.node.status.textContent = factor > 1 ? "Enlarged." : "Shrunk.";
}

function turnPiece(state, delta) {
  const piece = state.hover;
  if (!piece || !state.base) {
    return;
  }
  const source = piece.source || piece.image;
  const sourceWidth = piece.sourceWidth || piece.width;
  const sourceHeight = piece.sourceHeight || piece.height;
  let angle = ((piece.angle || 0) + delta) % 360;
  if (angle < 0) {
    angle += 360;
  }
  const next = renderPiece(
    source,
    sourceWidth,
    sourceHeight,
    angle,
    piece.x + piece.width / 2,
    piece.y + piece.height / 2
  );
  const limit = Math.max(state.node.canvas.width, state.node.canvas.height) * 3;
  if (next.width > limit || next.height > limit) {
    state.node.status.textContent = "That piece is already large.";
    return;
  }
  placeNext(state, piece, next);
  state.node.status.textContent = "Rotated.";
}

function savePane(state) {
  if (!state.base) {
    return;
  }
  const stem = (state.fileName || "image").replace(/\.[^.]+$/, "") || "image";
  const flat = document.createElement("canvas");
  flat.width = state.base.width;
  flat.height = state.base.height;
  const flatCtx = flat.getContext("2d");
  flatCtx.drawImage(state.base, 0, 0);
  for (const piece of state.pieces) {
    if (piece.floating) {
      flatCtx.drawImage(piece.image, piece.x, piece.y);
    }
  }
  flat.toBlob(async (blob) => {
    if (!blob) {
      state.node.status.textContent = "Could not save this image.";
      return;
    }
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-Image-Name": `${stem}.png`,
        },
        body: blob,
      });
      if (!response.ok) {
        state.node.status.textContent = "Could not save this image.";
        return;
      }
    } catch (error) {
      state.node.status.textContent = "Could not save this image.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stem}.png`;
    link.click();
    URL.revokeObjectURL(url);
    state.node.status.textContent = "Saved.";
  }, "image/png");
}

function pastePiece(state, point) {
  if (!clipboard || !state.base) {
    return;
  }
  const x = Math.round(point.x - clipboard.width / 2);
  const y = Math.round(point.y - clipboard.height / 2);
  const pasted = {
    x,
    y,
    width: clipboard.width,
    height: clipboard.height,
    image: clipboard.image,
    data: clipboard.data,
    floating: true,
  };
  state.pieces.push(pasted);
  state.hover = pasted;
  state.moving = null;
  paintView(state);
  state.node.status.textContent = "Pasted. Drag the piece, or right-click and choose Move.";
}

function movePiece(state, piece, x, y) {
  if (!piece || !state.base) {
    return piece;
  }
  let target = piece;
  if (!piece.floating) {
    target = {
      x: piece.x,
      y: piece.y,
      width: piece.width,
      height: piece.height,
      image: piece.image,
      data: piece.data,
      floating: true,
    };
    state.pieces.push(target);
    if (drag && drag.piece === piece) {
      drag.piece = target;
    }
  }
  target.x = Math.round(x);
  target.y = Math.round(y);
  state.hover = target;
  state.moving = null;
  paintView(state);
  state.node.status.textContent = "Moved.";
  return target;
}

function openPhoto(state, file) {
  if (!file || !file.type.startsWith("image/")) {
    state.node.status.textContent = "Please choose an image file.";
    return;
  }
  state.token += 1;
  const token = state.token;
  readPhoto(file)
    .then((bitmap) => {
      if (token !== state.token) {
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
        return;
      }
      const canvas = state.node.canvas;
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
      state.base = rememberBase(canvas);
      state.fileName = file.name || "";
      state.pieces = [];
      state.point = null;
      state.hover = null;
      state.node.save.disabled = false;
      showCanvas(canvas, state.node.placeholder);
      splitPane(state);
    })
    .catch(() => {
      if (token === state.token) {
        state.node.status.textContent = "That photo could not be read.";
      }
    });
}

function bindPane(state) {
  const frame = document.getElementById(state.frame);
  const canvas = document.getElementById(state.canvas);
  const placeholder = document.getElementById(state.placeholder);
  const save = document.getElementById(state.save);
  const button = document.getElementById(state.button);
  const input = document.getElementById(state.input);
  const status = document.getElementById(state.status);
  state.node = { frame, canvas, placeholder, save, button, input, status };

  save.addEventListener("click", () => savePane(state));
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    openPhoto(state, file);
    input.value = "";
  });
  frame.addEventListener("dragover", (event) => {
    event.preventDefault();
    frame.classList.add("is-hot");
  });
  frame.addEventListener("dragleave", () => frame.classList.remove("is-hot"));
  frame.addEventListener("drop", (event) => {
    event.preventDefault();
    frame.classList.remove("is-hot");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    openPhoto(state, file);
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.base) {
      return;
    }
    const point = canvasPoint(canvas, event);
    const piece = pieceAt(state, point);
    if (!piece) {
      return;
    }
    drag = {
      state,
      piece,
      offsetX: point.x - piece.x,
      offsetY: point.y - piece.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag && drag.state === state) {
      const point = canvasPoint(canvas, event);
      const travel = Math.hypot(point.x - drag.startX, point.y - drag.startY);
      if (!drag.moved && travel < 5) {
        return;
      }
      drag.moved = true;
      canvas.style.cursor = "grabbing";
      movePiece(state, drag.piece, point.x - drag.offsetX, point.y - drag.offsetY);
      return;
    }
    if (!state.base || pieceMenu.hidden === false) {
      return;
    }
    const point = canvasPoint(canvas, event);
    const next = pieceAt(state, point);
    canvas.style.cursor = next ? "grab" : "";
    if (next === state.hover) {
      return;
    }
    state.hover = next;
    paintView(state);
  });
  canvas.addEventListener("pointerup", () => {
    if (!drag || drag.state !== state) {
      return;
    }
    if (drag.moved) {
      skipClick = true;
    }
    drag = null;
    canvas.style.cursor = "";
  });
  canvas.addEventListener("pointerleave", () => {
    if ((drag && drag.state === state) || !pieceMenu.hidden || !state.hover) {
      return;
    }
    state.hover = null;
    canvas.style.cursor = "";
    paintView(state);
  });
  canvas.addEventListener("click", (event) => {
    if (!state.base || skipClick) {
      skipClick = false;
      return;
    }
    const point = canvasPoint(canvas, event);
    if (state.moving) {
      movePiece(
        state,
        state.moving,
        point.x - state.moving.width / 2,
        point.y - state.moving.height / 2
      );
      return;
    }
    state.point = point;
  });
  frame.addEventListener("contextmenu", (event) => {
    if (!state.base) {
      return;
    }
    event.preventDefault();
    const point =
      event.target === canvas
        ? canvasPoint(canvas, event)
        : state.point || { x: canvas.width / 2, y: canvas.height / 2 };
    showMenu(event, state, point);
  });
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (error) {}
  themeLightButton.setAttribute("aria-pressed", next === "light" ? "true" : "false");
  themeDarkButton.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
  const prism = document.getElementById("prism-bg");
  if (prism && typeof prism.setPrismLift === "function") {
    prism.setPrismLift(next === "light" ? 1 : 0);
  }
}

function startApp() {
  applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  themeLightButton.addEventListener("click", () => applyTheme("light"));
  themeDarkButton.addEventListener("click", () => applyTheme("dark"));
  document.querySelectorAll(".card").forEach(bindSpotlight);
  panes.forEach(bindPane);
  copyButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    clipboard = menuPane.hover;
    const pane = menuPane;
    pane.node.status.textContent = "Copied.";
    hideMenu();
    pane.hover = null;
    paintView(pane);
  });
  pasteButton.addEventListener("click", () => {
    if (!menuPane || !clipboard) {
      return;
    }
    pastePiece(menuPane, menuPane.point || menuPoint);
    hideMenu();
  });
  moveButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    menuPane.moving = menuPane.hover;
    menuPane.node.status.textContent = "Click the new place.";
    hideMenu();
  });
  enlargeButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    resizePiece(menuPane, RESIZE_STEP);
  });
  shrinkButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    resizePiece(menuPane, 1 / RESIZE_STEP);
  });
  rotateLeftButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    turnPiece(menuPane, -TURN_STEP);
  });
  rotateRightButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    turnPiece(menuPane, TURN_STEP);
  });
  deleteButton.addEventListener("click", () => {
    if (!menuPane || !menuPane.hover) {
      return;
    }
    deletePiece(menuPane);
    hideMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (pieceMenu.hidden || pieceMenu.contains(event.target)) {
      return;
    }
    if (event.button === 2 || performance.now() - menuShownAt < 500) {
      return;
    }
    hideMenu();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMenu();
      panes.forEach((pane) => {
        pane.moving = null;
      });
    }
  });
}

document.addEventListener("DOMContentLoaded", startApp);
