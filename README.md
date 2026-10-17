# ImageExtraction

ImageExtraction opens two photos and splits each one into pieces. A piece can be copied onto the other photo, then moved, enlarged, shrunk, rotated, or deleted.

The pasted piece is placed with its center on the point you click. Move, Enlarge, Shrink, and Rotate keep that center. The original photo stays underneath, so these steps do not leave a blank patch. Save downloads the photo and stores the same PNG.

## What it is for

- Split each opened photo into pieces that can be copied on their own.
- Paste a piece onto the other photo at the point you click.
- Drag a pasted piece to a new place, or choose Move and click the new place.
- Enlarge or shrink the pasted piece by a quarter, still centered on that point.
- Turn the piece left or right. Each step is 15 degrees.
- Delete a piece from the photo.
- Save the edited photo as a PNG, both as a download and as a stored copy.
- List the stored photos, or fetch one of them by its id.

## Licences

| Tool | Version | Licence |
| --- | --- | --- |
| SAM 2.1 (`facebook/sam2.1-hiera-small`) | — | Apache-2.0 |
| transformers | 5.19.0 | Apache-2.0 |
| torch | 2.14.1 | BSD-3-Clause |
| torchvision | 0.29.1 | BSD-3-Clause |
| Pillow | 12.3.0 | MIT-CMU |
| Caddy | 2.10.2 | Apache-2.0 |

SAM 2.1 runs on PyTorch. `torch` and `torchvision` are BSD-3-Clause for that reason. The page layout is from FaceFlower (MIT).

## Web UI

The page opens the two photos this program works on. After a photo opens, the page sends it to the SAM service, which returns one piece per component. Wait until the pane says how many pieces it found. Move over a piece to see its outline, then right-click that piece.

Each pane has **Save** to the left of **Open**. Save stays off until a photo is open. It stores that pane as a PNG and downloads the same file, using the opened file name, with every paste, move, resize, and turn included. The stored copy is the one listed by the saved-image routes below.

The menu has **Copy**, **Paste**, **Move**, **Enlarge**, **Shrink**, **Rotate left**, **Rotate right**, and **Delete**. Copy, Move, Enlarge, Shrink, Rotate, and Delete stay off until the pointer is on a piece. Paste stays off until a piece has been copied.

On the other photo, click the place you want, then right-click and choose Paste. Drag the pasted piece, or right-click it, choose Move, and click the new place. Enlarge and Shrink each change the size by a quarter. Rotate left and Rotate right each turn the piece by 15 degrees. The piece stays centered, and the original photo remains underneath. Delete removes the piece from the photo. The layout comes from FaceFlower (MIT).

Start it with:

```bash
docker compose up web
```

Then open [http://localhost:8090](http://localhost:8090). The host port is **8090**. Inside the container, Caddy serves the page on port 80.

Press **Open** on a pane, or drop a JPEG, PNG, or WebP photo onto that pane. The first split waits until SAM has loaded. Caddy forwards `/api/*` to the SAM service and strips the `/api` prefix. The page splits a photo with `/api/segment` and stores a saved photo with `/api/images`.

## Saved images

Save sends the flattened pane to `POST /api/images`. The body is a PNG of at most 25 MB. The opened file name goes in the `X-Image-Name` header. The service keeps a PNG under `saved/` in the `images` volume and answers with JSON:

```json
{"id": "photo-20261018T001300-000.png", "name": "photo-20261018T001300-000.png"}
```

The id is the safe file stem, the time it was stored, and three digits, ending in `.png`.

`GET /api/images` lists those files, newest first:

```json
{"images": [{"id": "photo-20261018T001300-000.png", "name": "photo-20261018T001300-000.png", "bytes": 77, "savedAt": 1792282380}]}
```

`savedAt` is the file's modification time in Unix seconds. `GET /api/images/<id>` returns that PNG. An unknown or unsafe id returns 404. Copy one stored photo out of the volume with:

```bash
docker compose cp sam2:/images/saved ./saved
```

## Tests

The saved-image tests talk to the service routes without loading SAM. They need Pillow 12.3.0, the same library the service uses.

```bash
python3 -m venv .venv
.venv/bin/pip install pillow==12.3.0
.venv/bin/python -m unittest discover -s tests
```

## Run the splitter

`compose.yaml` also runs the SAM 2.1 service, which splits an image into pieces.

```bash
docker compose up --build
docker compose cp photo.png sam2:/images/in/photo.png
```

The service must be up before the copy. The first start downloads the model. Pieces are written in the `images` volume at `out/<image-name>/`. `000.png` is the largest region and sits behind the later pieces.

```bash
docker compose cp sam2:/images/out/photo ./photo-pieces
```
