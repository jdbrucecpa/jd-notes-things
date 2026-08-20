from unittest.mock import MagicMock, patch
from pipeline.processor import Processor


class TestProcessor:
    def setup_method(self):
        self.mock_manager = MagicMock()
        self.processor = Processor(self.mock_manager)

    def test_process_calls_transcribe_and_diarize(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello there Hi back",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.5},
                {"word": "there", "start": 0.6, "end": 1.0},
                {"word": "Hi", "start": 1.5, "end": 1.8},
                {"word": "back", "start": 1.9, "end": 2.2},
            ],
            "duration": 2.2,
            "quality": None,
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.2},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
            raise Exception(f"Model {name} not available")
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")

        assert result["text"] == "Hello there Hi back"
        assert len(result["entries"]) == 2
        assert result["entries"][0]["speaker"] == "SPEAKER_00"
        assert result["entries"][0]["text"] == "Hello there"
        assert result["entries"][1]["speaker"] == "SPEAKER_01"
        assert result["entries"][1]["text"] == "Hi back"
        assert len(result["segments"]) == 2
        assert result["duration"] == 2.2

    def test_process_passes_speaker_options_to_diarizer(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Test", "words": [{"word": "Test", "start": 0.0, "end": 0.5}], "duration": 0.5,
            "quality": None,
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
            raise Exception(f"Model {name} not available")
        self.mock_manager.get_or_load.side_effect = get_or_load

        self.processor.process("test.mp3", min_speakers=2, max_speakers=5)

        mock_diarizer.diarize.assert_called_once_with(
            "test.mp3", num_speakers=None, min_speakers=2, max_speakers=5,
        )

    def test_process_with_no_words_returns_empty_entries(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {"text": "", "words": [], "duration": 0.0, "quality": None}
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = []

        def get_or_load(name, loader):
            if name == "transcriber":
                return mock_transcriber
            elif name == "diarizer":
                return mock_diarizer
            raise Exception(f"Model {name} not available")
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")

        assert result["entries"] == []
        assert result["text"] == ""

    def test_process_runs_alignment_when_available(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]
        mock_aligner = MagicMock()
        mock_aligner.align.return_value = mock_transcriber.transcribe.return_value

        def get_or_load(name, loader):
            return {"transcriber": mock_transcriber, "diarizer": mock_diarizer,
                    "aligner": mock_aligner}.get(name)
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")
        mock_aligner.align.assert_called_once()
        assert result["quality"]["avg_confidence"] == 0.95

    def test_process_continues_if_alignment_fails(self):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}],
            "duration": 0.5, "quality": {"flagged_segments": [], "avg_confidence": 0.95},
        }
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 0.5}]

        def get_or_load(name, loader):
            if name == "aligner":
                raise Exception("Alignment model not available")
            return {"transcriber": mock_transcriber, "diarizer": mock_diarizer}.get(name)
        self.mock_manager.get_or_load.side_effect = get_or_load

        result = self.processor.process("test.mp3")
        assert result["text"] == "Hello"

