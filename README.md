# ImageExtraction

ImageExtraction opens two photos and splits each one into pieces. A piece can be copied onto the other photo, then enlarged, shrunk, or deleted.

The pasted piece is placed with its center on the point you click. Enlarge and Shrink each change the size by a quarter and keep that center.

## What it is for

- Split each opened photo into pieces that can be copied on their own.
- Paste a piece onto the other photo at the point you click.
- Enlarge or shrink the pasted piece, still centered on that point.
- Delete a piece from the photo.

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

The menu has **Copy**, **Paste**, **Enlarge**, **Shrink**, and **Delete**. Copy, Enlarge, Shrink, and Delete stay off until the pointer is on a piece. Paste stays off until a piece has been copied.

On the other photo, click the place you want, then right-click and choose Paste. Right-click the pasted piece and choose Enlarge or Shrink. Each step changes the size by a quarter, and the piece stays centered. Delete removes the piece from the photo. The layout comes from FaceFlower (MIT).

Start it with:

```bash
docker compose up web
```

Then open [http://localhost:8090](http://localhost:8090). The host port is **8090**. Inside the container, Caddy serves the page on port 80.

Press **Open** on a pane, or drop a JPEG, PNG, or WebP photo onto that pane. The first split waits until SAM has loaded. Caddy forwards `/api/segment` to the SAM service.

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
