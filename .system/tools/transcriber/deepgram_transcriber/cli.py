import argparse
import os
import sys
from pathlib import Path

from deepgram import DeepgramClient, FileSource, PrerecordedOptions
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


def transcribe(audio_path: Path, language: str = "ru") -> str:
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("Error: DEEPGRAM_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    client = DeepgramClient(api_key)

    with open(audio_path, "rb") as f:
        buffer_data = f.read()

    payload: FileSource = {"buffer": buffer_data}

    options = PrerecordedOptions(
        model="nova-3",
        language=language,
        diarize=True,
        punctuate=True,
        utterances=True,
    )

    response = client.listen.rest.v("1").transcribe_file(payload, options, timeout=300)

    utterances = response.results.utterances
    if not utterances:
        return response.results.channels[0].alternatives[0].transcript

    lines = []
    current_speaker = None
    current_parts = []

    for utt in utterances:
        if utt.speaker == current_speaker:
            current_parts.append(utt.transcript)
        else:
            if current_speaker is not None:
                lines.append(f"[Speaker {current_speaker}]: {' '.join(current_parts)}")
            current_speaker = utt.speaker
            current_parts = [utt.transcript]

    if current_speaker is not None:
        lines.append(f"[Speaker {current_speaker}]: {' '.join(current_parts)}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe audio with speaker diarization using Deepgram nova-3"
    )
    parser.add_argument("input", type=Path, help="Input audio file (m4a, mp3, wav, etc.)")
    parser.add_argument("-o", "--output", type=Path, help="Output file (default: stdout)")
    parser.add_argument(
        "--language", default="ru", help="BCP-47 language code (default: ru)"
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Error: {args.input} not found", file=sys.stderr)
        sys.exit(1)

    text = transcribe(args.input, language=args.language)

    if args.output:
        args.output.write_text(text)
        print(f"Saved to {args.output}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
