#!/usr/bin/env python3
"""Image editing utility for cli-helper picker."""
import sys
import json
from pathlib import Path
from PIL import Image

def load_image(path):
    return Image.open(path).convert("RGBA" if "rembg" in sys.argv else "RGB")

def save_image(img, path):
    ext = Path(path).suffix.lower()
    if ext in ('.jpg', '.jpeg'):
        img = img.convert("RGB")
    img.save(path, quality=95)
    return path

def action_crop(path, out, left, top, right, bottom):
    img = load_image(path)
    w, h = img.size
    left = max(0, int(left * w))
    top = max(0, int(top * h))
    right = min(w, int(right * w))
    bottom = min(h, int(bottom * h))
    cropped = img.crop((left, top, right, bottom))
    save_image(cropped, out)
    return {"width": cropped.width, "height": cropped.height}

def action_resize(path, out, width, height):
    img = load_image(path)
    resized = img.resize((int(width), int(height)), Image.LANCZOS)
    save_image(resized, out)
    return {"width": resized.width, "height": resized.height}

def action_stretch(path, out, width, height):
    # Same as resize but intentionally ignores aspect ratio
    return action_resize(path, out, width, height)

def action_removebg(path, out):
    from rembg import remove
    img = Image.open(path)
    result = remove(img)
    result.save(out)
    return {"width": result.width, "height": result.height, "alpha": True}

def main():
    data = json.load(sys.stdin)
    action = data["action"]
    path = data["path"]
    out = data.get("out", path)
    params = data.get("params", {})

    if action == "crop":
        result = action_crop(path, out, **params)
    elif action == "resize":
        result = action_resize(path, out, **params)
    elif action == "stretch":
        result = action_stretch(path, out, **params)
    elif action == "removebg":
        result = action_removebg(path, out)
    else:
        raise ValueError(f"Unknown action: {action}")

    print(json.dumps({"success": True, "path": out, **result}))

if __name__ == "__main__":
    main()
