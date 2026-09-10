"""SAM3 text-prompted masks over JSON-lines stdio; run in the GPU host's SAM3 env.

One image request produces one result. No authoring state, policy loop, HTTP
service, downloads, or model fallback. Reuses the installed official SAM3 API.
"""

import base64
import contextlib
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image


def main():
    with contextlib.redirect_stdout(sys.stderr):
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        checkpoints = sorted(
            Path.home().glob(
                ".cache/huggingface/hub/models--facebook--sam3/snapshots/*/sam3.pt"
            )
        )
        if len(checkpoints) != 1:
            raise RuntimeError("expected exactly one installed SAM3 checkpoint")
        checkpoint = checkpoints[0]
        with checkpoint.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        model = build_sam3_image_model(
            checkpoint_path=str(checkpoint), load_from_HF=False, device="cuda"
        )
        processor = Sam3Processor(model, confidence_threshold=0.3)
    print(
        json.dumps(
            {"ok": True, "model": "SAM3", "checkpointSha256": digest, "prompt": "bird"}
        ),
        flush=True,
    )
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["requestId"]
            image = Image.open(
                io.BytesIO(base64.b64decode(request["image_png_b64"]))
            ).convert("RGB")
            with (
                contextlib.redirect_stdout(sys.stderr),
                torch.inference_mode(),
                torch.autocast("cuda", dtype=torch.bfloat16),
            ):
                state = processor.set_image(image)
                result = processor.set_text_prompt(prompt="bird", state=state)
                masks = result["masks"].detach().cpu().numpy().astype(bool)
                while masks.ndim > 3:
                    masks = masks[:, 0]
                scores = result["scores"].detach().float().cpu().numpy().tolist()
            payload = {
                "shape": list(masks.shape),
                "scores": scores,
                "masks_packed_b64": base64.b64encode(
                    np.packbits(masks, axis=None).tobytes()
                ).decode(),
            }
        except (ValueError, KeyError, OSError, RuntimeError) as error:
            payload = {"error": str(error)}
        payload["requestId"] = request_id
        print(json.dumps(payload), flush=True)


if __name__ == "__main__":
    main()
