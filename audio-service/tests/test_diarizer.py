"""Unit tests for Diarizer output extraction (no model load required)."""
import types
from unittest.mock import MagicMock, patch

from models.diarizer import Diarizer


class FakeAnnotation:
    """Minimal stand-in for pyannote.core.Annotation."""

    def __init__(self, tracks):
        # tracks: list of (start, end, label)
        self._tracks = tracks

    def itertracks(self, yield_label=False):
        for start, end, label in self._tracks:
            yield types.SimpleNamespace(start=start, end=end), None, label


def _make_diarizer(pipeline_output):
    """Build a Diarizer without loading real models."""
    d = Diarizer.__new__(Diarizer)
    d.pipeline = MagicMock(return_value=pipeline_output)
    return d


def _diarize(d):
    with patch("models.audio.load_audio", return_value={"waveform": None, "sample_rate": 16000}):
        return d.diarize("C:/fake/audio.mp3")


class TestDiarizerOutputExtraction:
    def test_prefers_exclusive_speaker_diarization(self):
        """community-1 provides a non-overlapping annotation built for
        merging with word-level transcripts — it must win over the
        overlapping standard annotation."""
        output = types.SimpleNamespace(
            exclusive_speaker_diarization=FakeAnnotation([
                (0.0, 1.0, "SPEAKER_00"),
                (1.0, 2.0, "SPEAKER_01"),
            ]),
            speaker_diarization=FakeAnnotation([
                (0.0, 1.5, "SPEAKER_00"),  # overlapping variant — must NOT be used
                (0.8, 2.0, "SPEAKER_01"),
            ]),
        )
        segments = _diarize(_make_diarizer(output))
        assert segments == [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
            {"speaker": "SPEAKER_01", "start": 1.0, "end": 2.0},
        ]

    def test_falls_back_to_speaker_diarization(self):
        """Pipelines without an exclusive annotation still work (e.g. 3.1)."""
        output = types.SimpleNamespace(
            speaker_diarization=FakeAnnotation([(0.0, 1.0, "SPEAKER_00")]),
        )
        segments = _diarize(_make_diarizer(output))
        assert segments == [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}]

    def test_none_exclusive_falls_back(self):
        """An explicitly-None exclusive annotation must not be used."""
        output = types.SimpleNamespace(
            exclusive_speaker_diarization=None,
            speaker_diarization=FakeAnnotation([(0.5, 1.5, "SPEAKER_01")]),
        )
        segments = _diarize(_make_diarizer(output))
        assert segments == [{"speaker": "SPEAKER_01", "start": 0.5, "end": 1.5}]

    def test_bare_annotation_output(self):
        """pyannote 3.x pipelines returned the Annotation directly."""
        output = FakeAnnotation([(0.0, 2.0, "SPEAKER_00")])
        segments = _diarize(_make_diarizer(output))
        assert segments == [{"speaker": "SPEAKER_00", "start": 0.0, "end": 2.0}]
