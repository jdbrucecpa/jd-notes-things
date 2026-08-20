from unittest.mock import MagicMock, patch
import numpy as np


class TestAligner:
    @patch("models.aligner.WAV2VEC2_ASR_BASE_960H")
    @patch("models.aligner.sf")
    def test_align_returns_dict_with_same_keys(self, mock_sf, mock_bundle):
        """Alignment should return a dict with the same structure."""
        mock_sf.read.return_value = (np.zeros(16000, dtype="float32"), 16000)
        mock_model = MagicMock()
        mock_bundle.get_model.return_value = mock_model
        mock_bundle.get_labels.return_value = list("-|ETAONIHSRDLCUMWFGYPBVKJXQZ'")
        mock_bundle.sample_rate = 16000

        from models.aligner import Aligner
        aligner = Aligner()

        transcription = {
            "text": "Hi",
            "words": [{"word": "Hi", "start": 0.0, "end": 0.5, "confidence": 0.95}],
            "segments": [{"text": "Hi", "start": 0.0, "end": 0.5}],
            "duration": 0.5,
            "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }

        result = aligner.align("test.wav", transcription)

        assert "words" in result
        assert "text" in result
        assert "segments" in result
        assert result["text"] == "Hi"

    @patch("models.aligner.WAV2VEC2_ASR_BASE_960H")
    @patch("models.aligner.sf")
    def test_align_preserves_words_on_audio_load_failure(self, mock_sf, mock_bundle):
        """If audio loading fails, return original transcription unchanged."""
        mock_sf.read.side_effect = Exception("File not found")
        mock_bundle.get_model.return_value = MagicMock()
        mock_bundle.get_labels.return_value = list("-|ETAONIHSRDLCUMWFGYPBVKJXQZ'")
        mock_bundle.sample_rate = 16000

        from models.aligner import Aligner
        aligner = Aligner()

        original_words = [{"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.95}]
        transcription = {
            "text": "Hello", "words": original_words,
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }

        result = aligner.align("test.wav", transcription)
        assert result["words"] == original_words

    @patch("models.aligner.WAV2VEC2_ASR_BASE_960H")
    @patch("models.aligner.sf")
    def test_align_handles_empty_transcription(self, mock_sf, mock_bundle):
        """Empty transcription should pass through unchanged."""
        mock_sf.read.return_value = (np.zeros(16000, dtype="float32"), 16000)
        mock_bundle.get_model.return_value = MagicMock()
        mock_bundle.get_labels.return_value = list("-|ETAONIHSRDLCUMWFGYPBVKJXQZ'")
        mock_bundle.sample_rate = 16000

        from models.aligner import Aligner
        aligner = Aligner()

        transcription = {
            "text": "", "words": [], "segments": [],
            "duration": 0.0, "quality": {"flagged_segments": [], "avg_confidence": 0.0},
        }

        result = aligner.align("test.wav", transcription)
        assert result["words"] == []
