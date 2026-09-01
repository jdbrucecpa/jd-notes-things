import logging
import torch
from pyannote.audio import Pipeline
from config import DIARIZATION_MODEL

logger = logging.getLogger(__name__)


class Diarizer:
    """Wrapper around PyAnnote speaker diarization pipeline."""

    def __init__(self):
        logger.info(f"Loading diarization model: {DIARIZATION_MODEL}")
        self.pipeline = Pipeline.from_pretrained(
            DIARIZATION_MODEL,
            token=self._get_hf_token(),
        )
        if torch.cuda.is_available():
            self.pipeline.to(torch.device("cuda"))
        logger.info("Diarization model loaded")

    def diarize(
        self,
        audio_path: str,
        num_speakers: int | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> list[dict]:
        """Run speaker diarization on audio file.

        Returns:
            List of {speaker, start, end} segments.
        """
        kwargs = {}
        if num_speakers is not None:
            kwargs["num_speakers"] = num_speakers
        if min_speakers is not None:
            kwargs["min_speakers"] = min_speakers
        if max_speakers is not None:
            kwargs["max_speakers"] = max_speakers

        from models.audio import load_audio
        audio = load_audio(audio_path)
        output = self.pipeline(audio, **kwargs)

        # pyannote.audio 4.x returns DiarizeOutput. Prefer the exclusive
        # (non-overlapping) annotation when the pipeline provides one
        # (community-1) — word-midpoint merging downstream is only
        # well-defined against non-overlapping turns. Fall back to the
        # standard annotation, then to the raw output (3.x bare Annotation).
        diarization = getattr(output, "exclusive_speaker_diarization", None)
        if diarization is None:
            diarization = getattr(output, "speaker_diarization", output)

        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": round(turn.start, 3),
                "end": round(turn.end, 3),
            })

        return segments

    @staticmethod
    def _get_hf_token() -> str | None:
        import os
        return os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
