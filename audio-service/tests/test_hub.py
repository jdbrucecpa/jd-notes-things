from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from huggingface_hub.errors import GatedRepoError, LocalEntryNotFoundError

from models import hub


def _gated(status):
    err = GatedRepoError.__new__(GatedRepoError)
    err.response = SimpleNamespace(status_code=status)
    return err


@pytest.fixture
def fake_hub(monkeypatch):
    """Stub snapshot_download: `cached` repos resolve locally, downloads
    raise whatever is registered in `fail`, otherwise succeed and cache."""
    state = {"cached": set(), "fail": {}, "downloads": [], "tokens": []}

    def snapshot_download(repo_id, local_files_only=False, token=None):
        if local_files_only:
            if repo_id in state["cached"]:
                return f"/cache/{repo_id}"
            raise LocalEntryNotFoundError("not cached")
        state["downloads"].append(repo_id)
        state["tokens"].append(token)
        if repo_id in state["fail"]:
            raise state["fail"][repo_id]
        state["cached"].add(repo_id)
        return f"/cache/{repo_id}"

    monkeypatch.setattr("huggingface_hub.snapshot_download", snapshot_download)
    return state


DIAR = hub.GATED_MODELS["diarizer"]
EMB = hub.GATED_MODELS["embedder"]


def test_status_reports_cache_per_model(fake_hub):
    fake_hub["cached"].add(EMB)
    status = {m["name"]: m["cached"] for m in hub.model_status()}
    assert status == {"diarizer": False, "embedder": True}


def test_prefetch_downloads_only_missing_models(fake_hub):
    fake_hub["cached"].add(EMB)
    results = hub.prefetch_models("hf_x")
    assert fake_hub["downloads"] == [DIAR]
    assert fake_hub["tokens"] == ["hf_x"]
    assert all(m["cached"] and m["error"] is None for m in results)


def test_prefetch_401_without_token_asks_for_one(fake_hub):
    fake_hub["fail"][DIAR] = _gated(401)
    diar = next(m for m in hub.prefetch_models(None) if m["name"] == "diarizer")
    assert diar["cached"] is False
    assert "token is required" in diar["error"]


def test_prefetch_401_with_token_says_token_rejected(fake_hub):
    fake_hub["fail"][DIAR] = _gated(401)
    diar = next(m for m in hub.prefetch_models("hf_bad") if m["name"] == "diarizer")
    assert "rejected the token" in diar["error"]


def test_prefetch_403_points_at_model_terms(fake_hub):
    fake_hub["fail"][DIAR] = _gated(403)
    diar = next(m for m in hub.prefetch_models("hf_x") if m["name"] == "diarizer")
    assert f"https://huggingface.co/{DIAR}" in diar["error"]


def test_one_failure_does_not_block_other_models(fake_hub):
    fake_hub["fail"][DIAR] = RuntimeError("disk full")
    results = {m["name"]: m for m in hub.prefetch_models("hf_x")}
    assert "disk full" in results["diarizer"]["error"]
    assert results["embedder"]["cached"] is True


class TestRoutes:
    @pytest.fixture
    def client(self):
        from unittest.mock import MagicMock
        from server import create_app
        return TestClient(create_app(model_manager=MagicMock(), processor=MagicMock()))

    def test_status_route(self, client, fake_hub):
        resp = client.get("/models/status")
        assert resp.status_code == 200
        assert {m["name"] for m in resp.json()["models"]} == {"diarizer", "embedder"}

    def test_prefetch_route_uses_body_token(self, client, fake_hub, monkeypatch):
        monkeypatch.setenv("HF_TOKEN", "hf_env")
        resp = client.post("/models/prefetch", json={"token": "hf_body"})
        assert resp.status_code == 200
        assert set(fake_hub["tokens"]) == {"hf_body"}

    def test_prefetch_route_falls_back_to_env_token(self, client, fake_hub, monkeypatch):
        monkeypatch.setenv("HF_TOKEN", "hf_env")
        client.post("/models/prefetch", json={})
        assert set(fake_hub["tokens"]) == {"hf_env"}
