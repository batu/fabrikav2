"""SAM2 segmentation service for the level-editor cutout ladder.

Runs on the GPU host (ubuntu-server / pato) inside ~/sam2-service:

    uv run --with fastapi --with uvicorn --with pillow python sam2_server.py

Loads SAM2.1 hiera-large from Hugging Face on first start. One endpoint
mirrors SAM2ImagePredictor.predict for the RemoteSam2Predictor client in
levelbuilder/api/inpaint.py. Tool-shaped: one request, one response.
"""

from __future__ import annotations

import base64
import io
import threading

import numpy as np
import uvicorn
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

MODEL = "facebook/sam2.1-hiera-large"

app = FastAPI()
_lock = threading.Lock()
_predictor = None


def predictor():
    global _predictor
    if _predictor is None:
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        _predictor = SAM2ImagePredictor.from_pretrained(MODEL, device="cuda")
    return _predictor


class PredictRequest(BaseModel):
    image_png_b64: str
    point: list[list[float]]
    point_labels: list[int]
    box: list[float]
    multimask_output: bool = True


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL}


@app.post("/predict")
def predict(req: PredictRequest) -> dict:
    image = np.array(
        Image.open(io.BytesIO(base64.b64decode(req.image_png_b64))).convert("RGB")
    )
    with _lock:
        p = predictor()
        p.set_image(image)
        masks, scores, _ = p.predict(
            point_coords=np.array(req.point, dtype=np.float32),
            point_labels=np.array(req.point_labels, dtype=np.int32),
            box=np.array(req.box, dtype=np.float32),
            multimask_output=req.multimask_output,
        )
    packed = np.packbits(masks.astype(np.uint8), axis=None)
    return {
        "shape": list(masks.shape),
        "masks_packed_b64": base64.b64encode(packed.tobytes()).decode(),
        "scores": [float(s) for s in np.asarray(scores).ravel()],
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8977)
