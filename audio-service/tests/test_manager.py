import time
import pytest
from unittest.mock import MagicMock, patch
from models.manager import ModelManager


class TestModelManager:
    def setup_method(self):
        self.manager = ModelManager(idle_timeout_seconds=2)

    def test_initial_state_nothing_loaded(self):
        assert self.manager.loaded_models == {}
        assert self.manager.is_loaded("transcriber") is False

    def test_get_or_load_calls_loader_once(self):
        mock_model = MagicMock()
        loader = MagicMock(return_value=mock_model)

        result1 = self.manager.get_or_load("transcriber", loader)
        result2 = self.manager.get_or_load("transcriber", loader)

        assert result1 is mock_model
        assert result2 is mock_model
        loader.assert_called_once()  # Only loaded once

    def test_get_or_load_updates_last_used(self):
        loader = MagicMock(return_value=MagicMock())
        self.manager.get_or_load("transcriber", loader)

        assert "transcriber" in self.manager.last_used
        assert self.manager.last_used["transcriber"] > 0

    def test_unload_specific_model(self):
        mock_model = MagicMock()
        loader = MagicMock(return_value=mock_model)
        self.manager.get_or_load("transcriber", loader)

        self.manager.unload("transcriber")

        assert self.manager.is_loaded("transcriber") is False

    def test_unload_all(self):
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        self.manager.get_or_load("diarizer", MagicMock(return_value=MagicMock()))

        freed = self.manager.unload_all()

        assert self.manager.loaded_models == {}
        assert freed == 2

    def test_unload_nonexistent_is_safe(self):
        self.manager.unload("nonexistent")  # Should not raise

    def test_collect_idle_unloads_expired(self):
        self.manager = ModelManager(idle_timeout_seconds=0)  # Immediate expiry
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        time.sleep(0.05)

        unloaded = self.manager.collect_idle()

        assert "transcriber" not in self.manager.loaded_models
        assert unloaded == ["transcriber"]

    def test_collect_idle_keeps_recent(self):
        self.manager = ModelManager(idle_timeout_seconds=300)
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))

        unloaded = self.manager.collect_idle()

        assert "transcriber" in self.manager.loaded_models
        assert unloaded == []

    def test_loaded_model_names(self):
        self.manager.get_or_load("transcriber", MagicMock(return_value=MagicMock()))
        self.manager.get_or_load("diarizer", MagicMock(return_value=MagicMock()))

        names = self.manager.loaded_model_names()
        assert set(names) == {"transcriber", "diarizer"}

    def test_collect_idle_frees_gpu_memory(self):
        """collect_idle should call _free_gpu_memory after unloading."""
        mgr = ModelManager(idle_timeout_seconds=0)
        mgr.loaded_models["test"] = "dummy"
        mgr.last_used["test"] = 0  # expired

        with patch.object(mgr, '_free_gpu_memory') as mock_free:
            unloaded = mgr.collect_idle()
            assert unloaded == ["test"]
            mock_free.assert_called_once()


class TestGpuMemoryMode:
    def _loaded(self, manager, *names):
        for name in names:
            manager.get_or_load(name, MagicMock(return_value=MagicMock()))

    def test_low_vram_keeps_only_the_requested_model(self):
        manager = ModelManager(low_vram=True)
        self._loaded(manager, "transcriber", "aligner", "embedder")
        with patch.object(ModelManager, "_free_gpu_memory"):
            manager.make_room_for("diarizer")
        assert manager.loaded_model_names() == []

        self._loaded(manager, "transcriber", "aligner")
        with patch.object(ModelManager, "_free_gpu_memory"):
            manager.make_room_for("aligner")
        assert manager.loaded_model_names() == ["aligner"]

    def test_high_vram_leaves_models_resident(self):
        manager = ModelManager(low_vram=False)
        self._loaded(manager, "transcriber", "aligner")
        manager.make_room_for("diarizer")
        assert set(manager.loaded_model_names()) == {"transcriber", "aligner"}

    @pytest.mark.parametrize("mode,expected", [("low", True), ("high", False)])
    def test_mode_override(self, monkeypatch, mode, expected):
        monkeypatch.setattr("config.GPU_MEMORY_MODE", mode)
        assert ModelManager().low_vram is expected

    @pytest.mark.parametrize("total_gb,expected", [(8, True), (12, True), (24, False)])
    def test_auto_detects_from_gpu_size(self, monkeypatch, total_gb, expected):
        monkeypatch.setattr("config.GPU_MEMORY_MODE", "auto")
        props = MagicMock(total_memory=total_gb * 2**30)
        with patch("torch.cuda.is_available", return_value=True), \
             patch("torch.cuda.get_device_properties", return_value=props):
            assert ModelManager().low_vram is expected

    def test_auto_without_cuda_is_not_low_vram(self, monkeypatch):
        monkeypatch.setattr("config.GPU_MEMORY_MODE", "auto")
        with patch("torch.cuda.is_available", return_value=False):
            assert ModelManager().low_vram is False
