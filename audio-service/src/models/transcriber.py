import logging
from faster_whisper import WhisperModel
from config import (
    TRANSCRIPTION_MODEL,
    TRANSCRIPTION_DEVICE,
    TRANSCRIPTION_COMPUTE_TYPE,
    MODEL_CACHE_DIR,
)

logger = logging.getLogger(__name__)


class Transcriber:
    """Wrapper around faster-whisper for speech-to-text."""

    def __init__(self):
        logger.info(f"Loading transcription model: {TRANSCRIPTION_MODEL}")
        self.model = WhisperModel(
            TRANSCRIPTION_MODEL,
            device=TRANSCRIPTION_DEVICE,
            compute_type=TRANSCRIPTION_COMPUTE_TYPE,
            download_root=str(MODEL_CACHE_DIR),
        )
        logger.info("Transcription model loaded")

    def transcribe(self, audio_path: str) -> dict:
        """Transcribe audio file to text with word-level timestamps.

        Args:
            audio_path: Path to audio file (WAV, MP3, FLAC, etc.).

        Returns:
            dict with keys: text, words, segments, duration, quality
        """
        segments_iter, info = self.model.transcribe(
            audio_path,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )

        # Must consume the generator immediately
        segments = list(segments_iter)

        words = []
        for seg in segments:
            for w in (seg.words or []):
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "confidence": round(w.probability, 3),
                })

        text = " ".join(seg.text.strip() for seg in segments)
        seg_list = [{
            "text": seg.text.strip(),
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
        } for seg in segments]

        quality = {
            "flagged_segments": [
                i for i, seg in enumerate(segments)
                if seg.compression_ratio > 2.4 or seg.avg_logprob < -1.0
            ],
            "avg_confidence": round(
                sum(w["confidence"] for w in words) / len(words), 3
            ) if words else 0.0,
        }

        return {
            "text": text,
            "words": words,
            "segments": seg_list,
            "duration": round(info.duration, 3),
            "quality": quality,
        }
