# ImageExtraction

ImageExtraction takes any uploaded image and splits the areas inside it into separate pieces. A piece can be copied and pasted into another open image, or into another program such as Word or Paint.

When the paste target is an image file, the areas inside that image are split as well. A fragment copied earlier can then be enlarged or reduced, moved to any place in the picture, and tucked behind a chosen image component.

## What it is for

- Split the regions of an uploaded image into pieces that can be copied on their own.
- Paste a piece into another image, a Word document, Paint, or a similar program.
- Split the destination image too, so the pasted fragment becomes part of that picture's pieces.
- Resize the fragment, place it anywhere, and put it behind any image component.

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

The page is the place to open the two photos this program works on. One pane holds the source picture, the other holds the picture you paste pieces into. Each pane keeps its own photo, and a new photo replaces only that pane. Nothing on the page is sent to a server. The layout comes from FaceFlower (MIT).

Start it with:

```bash
docker compose up web
```

Then open [http://localhost:8090](http://localhost:8090). The host port is **8090**. Inside the container, Caddy serves the page on port 80.

Press **Open** on a pane, or drop a JPEG, PNG, or WebP photo onto that pane.

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
