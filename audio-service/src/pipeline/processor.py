import logging
from models.manager import ModelManager
from pipeline.merger import merge_transcript_with_diarization

logger = logging.getLogger(__name__)


class Processor:
    """Orchestrates the full transcription + diarization pipeline."""

    def __init__(self, model_manager: ModelManager):
        self.manager = model_manager

    def process(
        self,
        audio_path: str,
        num_speakers: int | None = None,
        min_speakers: int | None = None,
        max_speakers: int | None = None,
    ) -> dict:
        """Full pipeline: transcribe → align → diarize → merge."""
        # Step 1: Transcribe
        logger.info(f"Transcribing: {audio_path}")
        transcriber = self.manager.get_or_load("transcriber", self._load_transcriber)
        transcription = transcriber.transcribe(audio_path)

        # Step 2: Align (optional — improves word timestamp precision)
        try:
            aligner = self.manager.get_or_load("aligner", self._load_aligner)
            transcription = aligner.align(audio_path, transcription)
        except Exception:
            logger.warning("Alignment unavailable, using native timestamps")

        # Step 3: Diarize
        logger.info(f"Diarizing: {audio_path}")
        diarizer = self.manager.get_or_load("diarizer", self._load_diarizer)
        segments = diarizer.diarize(
            audio_path,
            num_speakers=num_speakers,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )

        # Step 4: Merge
        entries = merge_transcript_with_diarization(transcription["words"], segments)

        return {
            "text": transcription["text"],
            "entries": entries,
            "segments": segments,
            "duration": transcription["duration"],
            "quality": transcription.get("quality"),
        }

    @staticmethod
    def _load_transcriber():
        from models.transcriber import Transcriber
        return Transcriber()

    @staticmethod
    def _load_diarizer():
        from models.diarizer import Diarizer
        return Diarizer()

    @staticmethod
    def _load_aligner():
        from models.aligner import Aligner
        return Aligner()

