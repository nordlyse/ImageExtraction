const themeLightButton = document.getElementById("theme-light-button");
const themeDarkButton = document.getElementById("theme-dark-button");
const pieceMenu = document.getElementById("piece-menu");
const copyButton = document.getElementById("copy-piece");
const pasteButton = document.getElementById("paste-piece");
const THEME_KEY = "image-extraction-theme";

const panes = [
  {
    id: "left",
    frame: "left-frame",
    canvas: "left-canvas",
    placeholder: "left-placeholder",
    button: "left-open",
    input: "left-file",
    status: "left-status",
  },
  {
    id: "right",
    frame: "right-frame",
    canvas: "right-canvas",
    placeholder: "right-placeholder",
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
  let best = null;
  let bestArea = Infinity;
  let boxBest = null;
  let boxArea = Infinity;
  for (const piece of state.pieces) {
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

function hideMenu() {
  pieceMenu.hidden = true;
  menuPane = null;
  menuPoint = null;
}

function showMenu(event, state, point) {
  menuShownAt = performance.now();
  menuPane = state;
  menuPoint = point;
  state.hover = pieceAt(state, point);
  paintView(state);
  copyButton.disabled = !state.hover;
  pasteButton.disabled = !clipboard;
  if (!state.hover) {
    state.node.status.textContent = state.splitting
      ? "Still splitting. Copy turns on when the piece count appears."
      : "Right-click the object itself to copy it.";
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
  state.pieces = [];
  state.hover = null;
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
  state.pieces = loaded;
  endSplit(state, token, `Image open. ${loaded.length} pieces.`);
}

function pastePiece(state, point) {
  if (!clipboard || !state.base) {
    return;
  }
  const x = Math.round(point.x - clipboard.width / 2);
  const y = Math.round(point.y - clipboard.height / 2);
  state.base.getContext("2d").drawImage(clipboard.image, x, y);
  state.hover = null;
  paintView(state);
  state.node.status.textContent = "Pasted.";
  splitPane(state);
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
      state.pieces = [];
      state.point = null;
      state.hover = null;
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
  const button = document.getElementById(state.button);
  const input = document.getElementById(state.input);
  const status = document.getElementById(state.status);
  state.node = { frame, canvas, placeholder, button, input, status };

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
  canvas.addEventListener("pointermove", (event) => {
    if (!state.base || pieceMenu.hidden === false) {
      return;
    }
    const point = canvasPoint(canvas, event);
    const next = pieceAt(state, point);
    if (next === state.hover) {
      return;
    }
    state.hover = next;
    paintView(state);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!pieceMenu.hidden) {
      return;
    }
    if (!state.hover) {
      return;
    }
    state.hover = null;
    paintView(state);
  });
  canvas.addEventListener("click", (event) => {
    if (!state.base) {
      return;
    }
    state.point = canvasPoint(canvas, event);
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
    }
  });
}

document.addEventListener("DOMContentLoaded", startApp);
