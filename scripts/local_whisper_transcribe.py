import argparse
import json
import sys

from faster_whisper import WhisperModel


def build_model(model_name: str, requested_device: str, requested_compute_type: str):
    candidates = []

    if requested_device == "auto":
        candidates.extend(
            [
                ("cuda", "float16"),
                ("cpu", "int8"),
            ]
        )
    elif requested_device == "cuda":
        candidates.append(
            (
                "cuda",
                "float16" if requested_compute_type == "auto" else requested_compute_type,
            )
        )
        candidates.append(("cpu", "int8"))
    else:
        candidates.append(
            (
                requested_device,
                "int8" if requested_compute_type == "auto" else requested_compute_type,
            )
        )

    errors = []

    for device, compute_type in candidates:
        try:
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
            return model, device, compute_type
        except Exception as error:  # pragma: no cover - hardware/runtime dependent
            errors.append(f"{device}/{compute_type}: {error}")

    raise RuntimeError("Could not initialize faster-whisper. " + " | ".join(errors))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True)
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="en")
    parser.add_argument("--beam-size", type=int, default=5)
    return parser.parse_args()


def main():
    args = parse_args()
    model, resolved_device, resolved_compute_type = build_model(
        args.model,
        args.device,
        args.compute_type,
    )
    segments, _info = model.transcribe(
        args.audio_path,
        beam_size=args.beam_size,
        language=args.language or None,
        condition_on_previous_text=False,
        vad_filter=True,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()

    print(
        json.dumps(
            {
                "text": text,
                "model": args.model,
                "device": resolved_device,
                "compute_type": resolved_compute_type,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
