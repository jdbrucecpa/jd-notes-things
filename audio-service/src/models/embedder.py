import logging
import numpy as np
from pyannote.audio import Model, Inference
from config import EMBEDDING_MODEL

logger = logging.getLogger(__name__)


class Embedder:
    """Wrapper around PyAnnote speaker embedding model."""

    def __init__(self):
        logger.info(f"Loading embedding model: {EMBEDDING_MODEL}")
        model = Model.from_pretrained(
            EMBEDDING_MODEL,
            token=self._get_hf_token(),
        )
        self.inference = Inference(model, window="whole")
        logger.info("Embedding model loaded")

    def embed_segments(
        self,
        audio_path: str,
        segments: list[dict],
    ) -> list[dict]:
        """Extract speaker embeddings for each diarization segment cluster.

        Groups segments by speaker, extracts embedding from longest segment
        per speaker (best audio quality).

        Args:
            audio_path: Path to audio file.
            segments: List of {speaker, start, end} from diarization.

        Returns:
            List of {speaker, vector, duration} per unique speaker.
        """
        from pyannote.core import Segment

        speaker_segments: dict[str, list[dict]] = {}
        for seg in segments:
            speaker_segments.setdefault(seg["speaker"], []).append(seg)

        from models.audio import load_audio
        audio = load_audio(audio_path)

        results = []
        for speaker, segs in speaker_segments.items():
            total_duration = sum(s["end"] - s["start"] for s in segs)

            longest = max(segs, key=lambda s: s["end"] - s["start"])
            excerpt = Segment(longest["start"], longest["end"])

            try:
                embedding = self.inference.crop(audio, excerpt)
                vector = embedding.flatten().tolist()
            except Exception as e:
                logger.warning(f"Failed to embed speaker {speaker}: {e}")
                continue

            results.append({
                "speaker": speaker,
                "vector": vector,
                "duration": round(total_duration, 3),
            })

        return results

    @staticmethod
    def _get_hf_token() -> str | None:
        import os
        return os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
