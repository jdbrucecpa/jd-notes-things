import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from server import create_app
from models.manager import ModelManager

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures"
TEST_AUDIO_WAV = FIXTURE_DIR / "two_speakers_short.wav"
TEST_AUDIO_MP3 = FIXTURE_DIR / "two_speakers_short.mp3"
TEST_AUDIO = TEST_AUDIO_WAV if TEST_AUDIO_WAV.exists() else TEST_AUDIO_MP3


@pytest.mark.gpu
@pytest.mark.skipif(not TEST_AUDIO.exists(), reason="Test audio fixture not found")
class TestFullPipeline:
    @pytest.fixture(autouse=True)
    def setup(self):
        manager = ModelManager(idle_timeout_seconds=300)
        app = create_app(manager)
        self.manager = manager
        with TestClient(app) as client:
            self.client = client
            yield
        manager.unload_all()

    def test_process_returns_diarized_transcript(self):
        resp = self.client.post("/process", json={
            "audioPath": str(TEST_AUDIO),
            "options": {"minSpeakers": 2, "maxSpeakers": 2},
        })
        assert resp.status_code == 200
        data = resp.json()

        assert len(data["text"]) > 0
        assert len(data["entries"]) > 0
        assert len(data["segments"]) > 0
        assert data["duration"] > 0

        speakers = set(e["speaker"] for e in data["entries"])
        assert len(speakers) >= 2

    def test_embed_speakers_returns_vectors(self):
        diarize_resp = self.client.post("/diarize", json={
            "audioPath": str(TEST_AUDIO),
            "minSpeakers": 2,
            "maxSpeakers": 2,
        })
        segments = diarize_resp.json()["segments"]

        embed_resp = self.client.post("/embed-speakers", json={
            "audioPath": str(TEST_AUDIO),
            "segments": segments,
        })
        assert embed_resp.status_code == 200
        data = embed_resp.json()

        assert len(data["embeddings"]) >= 2
        for emb in data["embeddings"]:
            assert len(emb["vector"]) > 0
            assert emb["duration"] > 0

    def test_full_identify_pipeline(self):
        proc_resp = self.client.post("/process", json={"audioPath": str(TEST_AUDIO)})
        segments = proc_resp.json()["segments"]

        embed_resp = self.client.post("/embed-speakers", json={
            "audioPath": str(TEST_AUDIO),
            "segments": segments,
        })
        embeddings = embed_resp.json()["embeddings"]

        # Transform embeddings into profile format (name field instead of speaker)
        profiles = [{"name": e["speaker"], "vector": e["vector"], "duration": e["duration"]} for e in embeddings]

        id_resp = self.client.post("/identify-speakers", json={
            "embeddings": embeddings,
            "profiles": profiles,
        })
        assert id_resp.status_code == 200
        matches = id_resp.json()["matches"]
        for match in matches:
            assert match["name"] is not None
            assert match["distance"] < 0.01

    def test_unload_frees_models(self):
        self.client.post("/process", json={"audioPath": str(TEST_AUDIO)})
        assert len(self.manager.loaded_model_names()) > 0

        resp = self.client.post("/unload")
        assert resp.status_code == 200
        assert self.manager.loaded_model_names() == []
