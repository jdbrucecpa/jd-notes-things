from unittest.mock import MagicMock, patch
from models.transcriber import Transcriber


def _make_segment(text, start, end, words=None, compression_ratio=1.5, avg_logprob=-0.3):
    seg = MagicMock()
    seg.text = text
    seg.start = start
    seg.end = end
    seg.words = words or []
    seg.compression_ratio = compression_ratio
    seg.avg_logprob = avg_logprob
    return seg


def _make_word(word, start, end, probability=0.95):
    w = MagicMock()
    w.word = word
    w.start = start
    w.end = end
    w.probability = probability
    return w


def _make_info(duration=10.0):
    info = MagicMock()
    info.duration = duration
    return info


class TestTranscriber:
    @patch("models.transcriber.WhisperModel")
    def test_transcribe_extracts_words(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        words = [
            _make_word(" Hello", 0.0, 0.5, 0.99),
            _make_word(" world", 0.6, 1.0, 0.95),
        ]
        seg = _make_segment("Hello world", 0.0, 1.0, words)
        mock_model.transcribe.return_value = (iter([seg]), _make_info(1.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["text"] == "Hello world"
        assert len(result["words"]) == 2
        assert result["words"][0]["word"] == "Hello"
        assert result["words"][0]["start"] == 0.0
        assert result["words"][0]["end"] == 0.5
        assert result["words"][0]["confidence"] == 0.99
        assert result["duration"] == 1.0

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_returns_segments(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        seg1 = _make_segment("Hello.", 0.0, 0.5)
        seg2 = _make_segment("Goodbye.", 1.0, 1.5)
        mock_model.transcribe.return_value = (iter([seg1, seg2]), _make_info(1.5))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert len(result["segments"]) == 2
        assert result["segments"][0]["text"] == "Hello."
        assert result["segments"][1]["start"] == 1.0

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_flags_hallucinated_segments(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model

        good_seg = _make_segment("Normal text", 0.0, 1.0, compression_ratio=1.2, avg_logprob=-0.3)
        bad_seg = _make_segment("Repeated repeated", 1.0, 2.0, compression_ratio=3.0, avg_logprob=-1.5)
        mock_model.transcribe.return_value = (iter([good_seg, bad_seg]), _make_info(2.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["quality"]["flagged_segments"] == [1]

    @patch("models.transcriber.WhisperModel")
    def test_transcribe_empty_audio(self, mock_cls):
        mock_model = MagicMock()
        mock_cls.return_value = mock_model
        mock_model.transcribe.return_value = (iter([]), _make_info(0.0))

        t = Transcriber()
        result = t.transcribe("test.wav")

        assert result["text"] == ""
        assert result["words"] == []
        assert result["duration"] == 0.0
        assert result["quality"]["flagged_segments"] == []
