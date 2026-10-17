"""Saved-image routes on the SAM service.

The page reaches these through Caddy as /api/images. The service itself
serves /images. Pillow is the only library these tests need.

    python3 -m venv .venv
    .venv/bin/pip install pillow==12.3.0
    .venv/bin/python -m unittest discover -s tests
"""

import http.client
import io
import json
import os
import socket
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sam"))


def install_missing_sam_stubs():
    """Let the service module import when torch is not installed."""
    if "numpy" not in sys.modules:
        try:
            import numpy  # noqa: F401
        except ModuleNotFoundError:
            numpy = types.ModuleType("numpy")
            numpy.bool_ = bool
            numpy.ndarray = object
            numpy.asarray = lambda value: value
            numpy.array = lambda value: value
            numpy.squeeze = lambda value: value
            sys.modules["numpy"] = numpy
    if "torch" not in sys.modules:
        try:
            import torch  # noqa: F401
        except ModuleNotFoundError:
            torch = types.ModuleType("torch")
            torch.Tensor = type("Tensor", (), {})
            torch.cuda = types.SimpleNamespace(is_available=lambda: False)
            sys.modules["torch"] = torch
    if "transformers" not in sys.modules:
        try:
            import transformers  # noqa: F401
        except ModuleNotFoundError:
            transformers = types.ModuleType("transformers")
            transformers.pipeline = lambda *args, **kwargs: None
            sys.modules["transformers"] = transformers


install_missing_sam_stubs()
import split_image  # noqa: E402


def png_bytes(color):
    image = Image.new("RGBA", (2, 2), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def warm_pillow():
    Image.open(io.BytesIO(png_bytes((0, 0, 0, 255)))).load()
    try:
        Image.open(io.BytesIO(b"not a picture"))
    except Exception:
        pass


class SavedImageRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        warm_pillow()
        split_image.SegmentHandler.log_message = lambda self, fmt, *args: None
        cls.server = split_image.ThreadingHTTPServer(("127.0.0.1", 0), split_image.SegmentHandler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.saved = Path(self.folder.name) / "saved"
        split_image.SAVED_DIR = self.saved

    def tearDown(self):
        self.folder.cleanup()

    def call(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            payload = response.read()
            return response.status, response.getheader("Content-Type"), payload
        finally:
            connection.close()

    def exchange(self, request):
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as sock:
            sock.settimeout(5)
            sock.sendall(request)
            chunks = []
            while True:
                try:
                    data = sock.recv(65536)
                except socket.timeout:
                    break
                if not data:
                    break
                chunks.append(data)
        raw = b"".join(chunks)
        head, _, body = raw.partition(b"\r\n\r\n")
        status = int(head.split(b"\r\n", 1)[0].split()[1])
        return status, head, body

    def store(self, raw, name="photo.png"):
        status, content_type, payload = self.call(
            "POST",
            "/images",
            body=raw,
            headers={"Content-Type": "image/png", "X-Image-Name": name},
        )
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json")
        stored = json.loads(payload)
        self.assertEqual(stored["id"], stored["name"])
        self.assertTrue(stored["id"].endswith(".png"))
        return stored["id"]

    def test_empty_list_before_any_image_is_stored(self):
        self.saved.mkdir()
        status, content_type, payload = self.call("GET", "/images")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json")
        self.assertEqual(json.loads(payload), {"images": []})

    def test_missing_folder_lists_nothing(self):
        status, _, payload = self.call("GET", "/images?unused=1")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload), {"images": []})

    def test_stores_an_image_and_returns_the_same_picture(self):
        raw = png_bytes((10, 20, 30, 255))
        with mock.patch.object(split_image.time, "strftime", return_value="20261018T001300"):
            with mock.patch.object(split_image.time, "time_ns", return_value=456_000_000):
                image_id = self.store(raw, "My Photo!.png")

        self.assertEqual(image_id, "My-Photo-20261018T001300-000.png")
        status, content_type, payload = self.call("GET", f"/images/{image_id}")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "image/png")
        opened = Image.open(io.BytesIO(payload))
        self.assertEqual(opened.size, (2, 2))
        self.assertEqual(opened.getpixel((0, 0)), (10, 20, 30, 255))

    def test_lists_saved_images_newest_first(self):
        older = self.store(png_bytes((1, 2, 3, 255)), "older.png")
        newer = self.store(png_bytes((4, 5, 6, 255)), "newer.png")
        os.utime(self.saved / older, (1_700_000_000, 1_700_000_000))
        os.utime(self.saved / newer, (1_800_000_000, 1_800_000_000))
        (self.saved / "notes.txt").write_text("skip", encoding="utf-8")

        status, _, payload = self.call("GET", "/images")
        self.assertEqual(status, 200)
        images = json.loads(payload)["images"]
        self.assertEqual([item["id"] for item in images], [newer, older])
        self.assertEqual(images[0]["name"], newer)
        self.assertEqual(images[0]["bytes"], (self.saved / newer).stat().st_size)
        self.assertEqual(images[0]["savedAt"], 1_800_000_000)
        self.assertEqual(images[1]["savedAt"], 1_700_000_000)

    def test_missing_image_is_not_found(self):
        status, _, _ = self.call("GET", "/images/absent.png")
        self.assertEqual(status, 404)

    def test_unsafe_ids_are_not_found(self):
        secret = b"secret-bytes"
        outside = Path(self.folder.name) / "secret.png"
        outside.write_bytes(secret)
        self.saved.mkdir()
        link = self.saved / "link.png"
        link.symlink_to(outside)

        requests = [
            b"GET /images/../secret.png HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
            b"GET /images/..\\secret.png HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
            b"GET /images/%2e%2e%2fsecret.png HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
            b"GET /images/link.png HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
            b"GET /images/notes.jpg HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
            b"GET /images/.. HTTP/1.1\r\nHost: t\r\nConnection: close\r\n\r\n",
        ]
        for request in requests:
            status, _, body = self.exchange(request)
            self.assertEqual(status, 404, request)
            self.assertNotIn(secret, body)

    def test_empty_or_huge_body_is_rejected(self):
        status, _, body = self.call("POST", "/images", body=b"")
        self.assertEqual(status, 400)
        self.assertIn(b"Image body is missing or too large", body)

        status, _, body = self.exchange(
            b"POST /images HTTP/1.1\r\nHost: t\r\nContent-Length: 25000001\r\n"
            b"Connection: close\r\n\r\n"
        )
        self.assertEqual(status, 400)
        self.assertIn(b"Image body is missing or too large", body)

    def test_bytes_that_are_not_a_picture_are_rejected(self):
        status, _, body = self.call(
            "POST",
            "/images",
            body=b"this is not a picture",
            headers={"X-Image-Name": "bad.png"},
        )
        self.assertEqual(status, 400)
        self.assertIn(b"Image body is not a picture", body)
        self.assertEqual(list(self.saved.glob("*.png")), [])

    def test_other_routes_stay_unchanged(self):
        status, content_type, payload = self.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertIn("text/plain", content_type)
        self.assertEqual(payload, b"ok\n")

        status, _, _ = self.call("GET", "/missing")
        self.assertEqual(status, 404)

        status, _, body = self.call("POST", "/segment", body=png_bytes((0, 0, 0, 255)))
        self.assertEqual(status, 503)
        self.assertIn(b"SAM is still loading", body)


if __name__ == "__main__":
    unittest.main()
