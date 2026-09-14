"""Bounded UI-asset adapter over the existing Layer provider; no level identities.

uv run --with pillow --with httpx --with python-dotenv python .../generate-ui-gesture.py
  --source hand.png --request request.json --out output-name --env /path/to/.env
Use --resume after a submitted job loses its polling connection.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from levelbuilder.api import layer_provider as provider


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--env', type=Path, required=True)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    load_dotenv(args.env)
    request = json.loads(args.request.read_text())
    os.environ['LAYER_WORKSPACE_ID'] = request['workspaceId']
    job_file = args.out.with_suffix('.job.json')
    if job_file.exists() and not args.resume:
        raise SystemExit('Existing job; use --resume, do not resubmit')
    if args.resume:
        job = json.loads(job_file.read_text())
        with provider.httpx.Client(timeout=30) as client:
            token = provider.layer_token()
            response = client.get(f"{provider.LAYER_API_BASE}/v1/workspaces/{job['workspaceId']}/inferences/{job['providerJobId']}", headers=provider._headers(token))
            response.raise_for_status()
            payload = provider._poll_inference(client, token, job['workspaceId'], job['providerJobId'], response.json())
            output = provider._output_from_inference(payload, kind='animation')
            downloaded = provider._download_output(client, output)
            content_type = output.get('content_type') or downloaded.headers.get('content-type')
            content = downloaded.content
            extension = provider._extension_for_content_type(content_type)
            metadata = {**job, 'contentType': content_type, 'actualCreativeUnits': provider._creative_units(payload)}
    else:
        result = provider.generate_layer_sprite_animation(
            source_image_path=args.source, prompt=request['prompt'], motion_preset=args.out.name,
            idempotency_key=request['idempotencyKey'],
            on_submitted=lambda job: job_file.write_text(json.dumps(job, indent=2)),
        )
        content, extension, metadata = result.content, result.extension, result.metadata
    path = args.out.with_suffix(extension)
    path.write_bytes(content)
    metadata.update(sourceSha256=hashlib.sha256(args.source.read_bytes()).hexdigest(), outputSha256=hashlib.sha256(content).hexdigest())
    args.out.with_suffix('.result.json').write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata))


if __name__ == '__main__':
    main()
