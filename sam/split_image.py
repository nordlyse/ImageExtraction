import base64
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import pipeline

MODEL = "facebook/sam2.1-hiera-small"
IN_DIR = Path("/images/in")
OUT_DIR = Path("/images/out")
SAVED_DIR = Path("/images/saved")
SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
LOCK = threading.Lock()
GENERATOR = None


def mask_alpha(mask, size):
    if isinstance(mask, Image.Image):
        alpha = mask.convert("L")
    else:
        if isinstance(mask, torch.Tensor):
            array = mask.detach().cpu().numpy()
        else:
            array = np.asarray(mask)
        array = np.squeeze(array)
        if array.dtype == np.bool_:
            array = array.astype(np.uint8) * 255
        else:
            array = (array > 0.5).astype(np.uint8) * 255
        alpha = Image.fromarray(array, mode="L")
    if alpha.size != size:
        alpha = alpha.resize(size, Image.Resampling.NEAREST)
    return alpha


def masks_of(outputs):
    masks = outputs["masks"]
    if isinstance(masks, torch.Tensor):
        if masks.ndim == 2:
            return [masks]
        return [masks[index] for index in range(masks.shape[0])]
    if isinstance(masks, np.ndarray) and masks.ndim >= 3:
        return [masks[index] for index in range(masks.shape[0])]
    return list(masks)


def split_rgba(image):
    with LOCK:
        outputs = GENERATOR(
            image.convert("RGB"),
            points_per_batch=64,
            points_per_crop=16,
        )
    image_area = image.size[0] * image.size[1]
    pieces = []
    for mask in masks_of(outputs):
        alpha = mask_alpha(mask, image.size)
        box = alpha.getbbox()
        if box is None:
            continue
        rgba = image.copy()
        rgba.putalpha(alpha)
        cropped = rgba.crop(box)
        if cropped.size[0] < 4 or cropped.size[1] < 4:
            continue
        if cropped.size[0] * cropped.size[1] >= image_area * 0.82:
            continue
        buffer = io.BytesIO()
        cropped.save(buffer, format="PNG")
        pieces.append(
            {
                "x": box[0],
                "y": box[1],
                "width": cropped.size[0],
                "height": cropped.size[1],
                "png": base64.b64encode(buffer.getvalue()).decode("ascii"),
            }
        )
    pieces.sort(key=lambda item: item["width"] * item["height"], reverse=True)
    pieces = pieces[:16]
    print(
        f"Split request {image.size[0]}x{image.size[1]} into {len(pieces)} pieces",
        flush=True,
    )
    return pieces


def write_pieces(path):
    image = Image.open(path).convert("RGBA")
    with LOCK:
        outputs = GENERATOR(
            image.convert("RGB"),
            points_per_batch=64,
            points_per_crop=16,
        )
    pieces = []
    for mask in masks_of(outputs):
        alpha = mask_alpha(mask, image.size)
        pieces.append((int(np.array(alpha).sum()), alpha))
    pieces.sort(key=lambda item: item[0], reverse=True)
    target = OUT_DIR / path.stem
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("*.png"):
        old.unlink()
    for index, (_, alpha) in enumerate(pieces):
        piece = image.copy()
        piece.putalpha(alpha)
        piece.save(target / f"{index:03d}.png")
    print(f"Split {path.name} into {len(pieces)} pieces", flush=True)


def stable_images(seen):
    ready = []
    for path in sorted(IN_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUFFIXES:
            continue
        stat = path.stat()
        key = (stat.st_mtime_ns, stat.st_size)
        if seen.get(path.name) == key:
            continue
        time.sleep(0.3)
        stat_again = path.stat()
        key_again = (stat_again.st_mtime_ns, stat_again.st_size)
        if key_again != key:
            continue
        ready.append((path, key_again))
    return ready


def watch_folder():
    seen = {}
    print(f"Watching {IN_DIR}", flush=True)
    while True:
        for path, key in stable_images(seen):
            try:
                write_pieces(path)
            except Exception as error:
                print(f"Could not split {path.name}: {error}", flush=True)
                continue
            seen[path.name] = key
        time.sleep(2)


def safe_stem(name):
    stem = Path(name or "image").stem
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in stem).strip("-")
    return cleaned or "image"


def saved_file(image_id):
    if not image_id or "/" in image_id or "\\" in image_id or image_id in {".", ".."}:
        return None
    if not image_id.endswith(".png"):
        return None
    if not all(ch.isalnum() or ch in "-_." for ch in image_id):
        return None
    path = (SAVED_DIR / image_id).resolve()
    if SAVED_DIR.resolve() not in path.parents:
        return None
    return path


def list_saved_images():
    if not SAVED_DIR.is_dir():
        return []
    images = []
    for path in SAVED_DIR.iterdir():
        if not path.is_file() or path.suffix.lower() != ".png":
            continue
        stat = path.stat()
        images.append(
            {
                "id": path.name,
                "name": path.name,
                "bytes": stat.st_size,
                "savedAt": int(stat.st_mtime),
            }
        )
    images.sort(key=lambda item: item["savedAt"], reverse=True)
    return images


def add_saved_image(name, raw):
    SAVED_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%S")
    image_id = f"{safe_stem(name)}-{stamp}-{time.time_ns() % 1000:03d}.png"
    path = SAVED_DIR / image_id
    Image.open(io.BytesIO(raw)).convert("RGBA").save(path, format="PNG")
    return image_id


class SegmentHandler(BaseHTTPRequestHandler):
    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self.send_body(200, b"ok\n", "text/plain; charset=utf-8")
            return
        if path == "/images":
            payload = json.dumps({"images": list_saved_images()}).encode("utf-8")
            self.send_body(200, payload, "application/json")
            return
        if path.startswith("/images/"):
            image_path = saved_file(path[len("/images/") :])
            if image_path is None or not image_path.is_file():
                self.send_error(404)
                return
            self.send_body(200, image_path.read_bytes(), "image/png")
            return
        self.send_error(404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/images":
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length <= 0 or length > 25_000_000:
                self.send_error(400, "Image body is missing or too large")
                return
            raw = self.rfile.read(length)
            try:
                image_id = add_saved_image(self.headers.get("X-Image-Name", "image.png"), raw)
            except Exception as error:
                print(f"Could not store image: {error}", flush=True)
                self.send_error(400, "Image body is not a picture")
                return
            payload = json.dumps({"id": image_id, "name": image_id}).encode("utf-8")
            self.send_body(200, payload, "application/json")
            return
        if path != "/segment":
            self.send_error(404)
            return
        if GENERATOR is None:
            self.send_error(503, "SAM is still loading")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 25_000_000:
            self.send_error(400, "Image body is missing or too large")
            return
        raw = self.rfile.read(length)
        try:
            image = Image.open(io.BytesIO(raw)).convert("RGBA")
            pieces = split_rgba(image)
            payload = json.dumps(
                {"width": image.size[0], "height": image.size[1], "pieces": pieces}
            ).encode("utf-8")
        except Exception as error:
            print(f"Could not split request: {error}", flush=True)
            self.send_error(500, "Could not split this image")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


def main():
    global GENERATOR
    IN_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SAVED_DIR.mkdir(parents=True, exist_ok=True)
    device = 0 if torch.cuda.is_available() else -1
    print(f"Loading {MODEL}", flush=True)
    GENERATOR = pipeline("mask-generation", model=MODEL, device=device)
    Path("/tmp/sam2-ready").write_text("ok\n")
    threading.Thread(target=watch_folder, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 8080), SegmentHandler)
    print("SAM API listening on 8080", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
