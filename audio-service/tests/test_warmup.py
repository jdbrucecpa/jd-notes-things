from fastapi.testclient import TestClient
from server import create_app
from models.manager import ModelManager


def test_warmup_reports_models_and_returns_immediately(monkeypatch):
    mgr = ModelManager()
    loaded = []
    # get_or_load is called from a background thread; stub it to record names
    monkeypatch.setattr(
        mgr, "get_or_load", lambda name, loader: loaded.append(name)
    )

    # Mock model imports to prevent the background thread from failing
    class MockTranscriber:
        pass

    class MockDiarizer:
        pass

    class MockEmbedder:
        pass

    monkeypatch.setattr("models.transcriber.Transcriber", MockTranscriber)
    monkeypatch.setattr("models.diarizer.Diarizer", MockDiarizer)
    monkeypatch.setattr("models.embedder.Embedder", MockEmbedder)

    app = create_app(mgr)
    client = TestClient(app)

    resp = client.post("/warmup")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["loading"]) == {"transcriber", "diarizer", "embedder"}
    # background thread runs promptly under TestClient
    import time
    for _ in range(50):
        if len(loaded) == 3:
            break
        time.sleep(0.05)
    assert set(loaded) == {"transcriber", "diarizer", "embedder"}
