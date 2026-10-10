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

SAM 2.1 runs on PyTorch. `torch` and `torchvision` are BSD-3-Clause for that reason.

## Run

`compose.yaml` runs the SAM 2.1 service.

```bash
docker compose up --build
docker compose cp photo.png sam2:/images/in/photo.png
```

The service must be up before the copy. The first start downloads the model. Pieces are written in the `images` volume at `out/<image-name>/`. `000.png` is the largest region and sits behind the later pieces.

```bash
docker compose cp sam2:/images/out/photo ./photo-pieces
```
