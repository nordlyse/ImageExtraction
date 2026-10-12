const themeLightButton = document.getElementById("theme-light-button");
const themeDarkButton = document.getElementById("theme-dark-button");
const THEME_KEY = "image-extraction-theme";

const panes = [
  {
    frame: "left-frame",
    canvas: "left-canvas",
    placeholder: "left-placeholder",
    button: "left-open",
    input: "left-file",
    status: "left-status",
  },
  {
    frame: "right-frame",
    canvas: "right-canvas",
    placeholder: "right-placeholder",
    button: "right-open",
    input: "right-file",
    status: "right-status",
  },
];

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

function paintPhoto(canvas, placeholder, status, file) {
  if (!file || !file.type.startsWith("image/")) {
    status.textContent = "Please choose an image file.";
    return;
  }
  readPhoto(file)
    .then((bitmap) => {
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
      showCanvas(canvas, placeholder);
      status.textContent = "Image open.";
    })
    .catch(() => {
      status.textContent = "That photo could not be read.";
    });
}

function bindPane(pane) {
  const frame = document.getElementById(pane.frame);
  const canvas = document.getElementById(pane.canvas);
  const placeholder = document.getElementById(pane.placeholder);
  const button = document.getElementById(pane.button);
  const input = document.getElementById(pane.input);
  const status = document.getElementById(pane.status);

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    paintPhoto(canvas, placeholder, status, file);
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
    paintPhoto(canvas, placeholder, status, file);
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
}

document.addEventListener("DOMContentLoaded", startApp);
