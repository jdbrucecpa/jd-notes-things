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

    # Mock model classes so their constructors don't try to load real ML models
    # (Transcriber(), Diarizer(), Embedder() instantiation blocks indefinitely in test env)
    monkeypatch.setattr("models.transcriber.Transcriber", type("MockTranscriber", (), {}))
    monkeypatch.setattr("models.diarizer.Diarizer", type("MockDiarizer", (), {}))
    monkeypatch.setattr("models.embedder.Embedder", type("MockEmbedder", (), {}))

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


def test_warmup_continues_on_per_model_failure(monkeypatch):
    """Verify that if one model fails to load, the others are still attempted."""
    mgr = ModelManager()
    loaded = []
    failed = []

    def get_or_load_with_failure(name, loader):
        if name == "diarizer":
            failed.append(name)
            raise RuntimeError("Simulated diarizer load failure")
        loaded.append(name)

    monkeypatch.setattr(mgr, "get_or_load", get_or_load_with_failure)

    # Mock model classes so their constructors don't try to load real ML models
    monkeypatch.setattr("models.transcriber.Transcriber", type("MockTranscriber", (), {}))
    monkeypatch.setattr("models.diarizer.Diarizer", type("MockDiarizer", (), {}))
    monkeypatch.setattr("models.embedder.Embedder", type("MockEmbedder", (), {}))

    app = create_app(mgr)
    client = TestClient(app)

    resp = client.post("/warmup")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["loading"]) == {"transcriber", "diarizer", "embedder"}

    # background thread runs promptly under TestClient
    import time
    for _ in range(50):
        if len(loaded) + len(failed) == 3:
            break
        time.sleep(0.05)

    # transcriber and embedder should load despite diarizer failure
    assert set(loaded) == {"transcriber", "embedder"}
    assert set(failed) == {"diarizer"}
