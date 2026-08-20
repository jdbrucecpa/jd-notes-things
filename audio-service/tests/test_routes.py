import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


@pytest.fixture
def mock_manager():
    mgr = MagicMock()
    mgr.loaded_models = {}
    mgr.loaded_model_names.return_value = []
    return mgr


@pytest.fixture
def mock_processor():
    return MagicMock()


@pytest.fixture
def client(mock_manager, mock_processor):
    from server import create_app
    app = create_app(model_manager=mock_manager, processor=mock_processor)
    yield TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_status(self, client, mock_manager):
        mock_manager.loaded_model_names.return_value = []
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "idle"
        assert "engineVersion" in data
        assert "device" in data


class TestModelsEndpoint:
    def test_models_returns_available(self, client):
        resp = client.get("/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "transcription" in data
        assert "large-v3-turbo" in data["transcription"]


class TestProcessEndpoint:
    def test_process_returns_transcript(self, client, mock_processor):
        mock_processor.process.return_value = {
            "text": "Hello world",
            "entries": [{"speaker": "SPEAKER_00", "text": "Hello world", "timestamp": 0.0, "words": []}],
            "segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}],
            "duration": 1.0,
        }

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test/audio.mp3"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "Hello world"
        assert len(data["entries"]) == 1

    def test_process_validates_audio_path_required(self, client):
        resp = client.post("/process", json={})
        assert resp.status_code == 422


class TestUnloadEndpoint:
    def test_unload_frees_models(self, client, mock_manager):
        mock_manager.unload_all.return_value = 2
        resp = client.post("/unload")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "unloaded"


class TestTranscribeEndpoint:
    def test_transcribe_calls_model(self, client, mock_manager):
        mock_transcriber = MagicMock()
        mock_transcriber.transcribe.return_value = {
            "text": "Hello", "words": [{"word": "Hello", "start": 0.0, "end": 0.5}],
            "segments": [{"text": "Hello", "start": 0.0, "end": 0.5}], "duration": 0.5,
        }
        mock_manager.get_or_load.return_value = mock_transcriber

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/transcribe", json={"audioPath": "C:/test/audio.mp3"})

        assert resp.status_code == 200
        assert resp.json()["text"] == "Hello"


class TestDiarizeEndpoint:
    def test_diarize_calls_model(self, client, mock_manager):
        mock_diarizer = MagicMock()
        mock_diarizer.diarize.return_value = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0},
        ]
        mock_manager.get_or_load.return_value = mock_diarizer

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/diarize", json={"audioPath": "C:/test/audio.mp3", "minSpeakers": 2})

        assert resp.status_code == 200
        assert len(resp.json()["segments"]) == 1


class TestEmbedSpeakersEndpoint:
    def test_embed_calls_model(self, client, mock_manager):
        mock_embedder = MagicMock()
        mock_embedder.embed_segments.return_value = [
            {"speaker": "SPEAKER_00", "vector": [0.1] * 256, "duration": 10.0},
        ]
        mock_manager.get_or_load.return_value = mock_embedder

        with patch("os.path.isfile", return_value=True):
            resp = client.post("/embed-speakers", json={
                "audioPath": "C:/test/audio.mp3",
                "segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}],
            })

        assert resp.status_code == 200
        assert len(resp.json()["embeddings"]) == 1


class TestIdentifySpeakersEndpoint:
    def test_identify_returns_matches(self, client):
        resp = client.post("/identify-speakers", json={
            "embeddings": [{"speaker": "Speaker 1", "vector": [0.1] * 256, "duration": 30.0}],
            "profiles": [{"name": "Tim", "vector": [0.1] * 256, "duration": 120.0}],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["matches"]) == 1
        assert data["matches"][0]["name"] == "Tim"


class TestGpuErrorHandler:
    def test_cuda_runtime_error_returns_503(self, client, mock_processor):
        mock_processor.process.side_effect = RuntimeError("CUDA out of memory")
        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 503

    def test_generic_cuda_exception_returns_503(self, client, mock_processor):
        mock_processor.process.side_effect = Exception("CUDA error: device-side assert triggered")
        with patch("os.path.isfile", return_value=True):
            resp = client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 503

    def test_non_gpu_exception_propagates(self, mock_manager, mock_processor):
        from server import create_app
        app = create_app(model_manager=mock_manager, processor=mock_processor)
        no_raise_client = TestClient(app, raise_server_exceptions=False)
        mock_processor.process.side_effect = ValueError("bad input")
        with patch("os.path.isfile", return_value=True):
            resp = no_raise_client.post("/process", json={"audioPath": "C:/test.mp3"})
        assert resp.status_code == 500
