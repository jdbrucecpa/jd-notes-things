import time
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)


def _detect_low_vram() -> bool:
    from config import GPU_MEMORY_MODE, LOW_VRAM_THRESHOLD_GB

    if GPU_MEMORY_MODE == "low":
        return True
    if GPU_MEMORY_MODE == "high":
        return False
    try:
        import torch
        if not torch.cuda.is_available():
            return False
        total_gb = torch.cuda.get_device_properties(0).total_memory / 2**30
        return total_gb <= LOW_VRAM_THRESHOLD_GB
    except Exception:
        logger.exception("Could not read GPU memory size; assuming plenty")
        return False


class ModelManager:
    """Manages lazy loading and auto-unloading of GPU models."""

    def __init__(self, idle_timeout_seconds: int = 300, low_vram: bool | None = None):
        self.idle_timeout_seconds = idle_timeout_seconds
        self.loaded_models: dict[str, Any] = {}
        self.last_used: dict[str, float] = {}
        self._lock = threading.Lock()
        # None = detect from the GPU on first use (see config.GPU_MEMORY_MODE)
        self._low_vram = low_vram

    @property
    def low_vram(self) -> bool:
        if self._low_vram is None:
            self._low_vram = _detect_low_vram()
            logger.info(
                "GPU memory mode: %s",
                "low (one model resident at a time)" if self._low_vram else "high (models stay resident)",
            )
        return self._low_vram

    def make_room_for(self, name: str) -> None:
        """On a low-VRAM GPU, unload every model except `name` before a stage
        runs, so it gets the whole card instead of spilling into system RAM."""
        if not self.low_vram:
            return
        with self._lock:
            others = [n for n in self.loaded_models if n != name]
        for other in others:
            self.unload(other)

    def release_cached_memory(self) -> None:
        """Hand PyTorch's cached-but-unused blocks back to the driver (e.g. the
        whole-meeting waveform alignment staged on the GPU)."""
        self._free_gpu_memory()

    def get_or_load(self, name: str, loader: Callable[[], Any]) -> Any:
        with self._lock:
            if name not in self.loaded_models:
                logger.info(f"Loading model: {name}")
                self.loaded_models[name] = loader()
                logger.info(f"Model loaded: {name}")
            self.last_used[name] = time.monotonic()
            return self.loaded_models[name]

    def is_loaded(self, name: str) -> bool:
        return name in self.loaded_models

    def unload(self, name: str) -> None:
        with self._lock:
            if name in self.loaded_models:
                logger.info(f"Unloading model: {name}")
                del self.loaded_models[name]
                self.last_used.pop(name, None)
                self._free_gpu_memory()

    def unload_all(self) -> int:
        with self._lock:
            count = len(self.loaded_models)
            self.loaded_models.clear()
            self.last_used.clear()
            if count > 0:
                self._free_gpu_memory()
            logger.info(f"Unloaded all models ({count})")
            return count

    @staticmethod
    def _free_gpu_memory():
        import gc
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    def collect_idle(self) -> list[str]:
        now = time.monotonic()
        to_unload = []
        with self._lock:
            for name, last in list(self.last_used.items()):
                if now - last > self.idle_timeout_seconds:
                    to_unload.append(name)
            for name in to_unload:
                logger.info(f"Auto-unloading idle model: {name}")
                del self.loaded_models[name]
                del self.last_used[name]
            if to_unload:
                self._free_gpu_memory()
        return to_unload

    def loaded_model_names(self) -> list[str]:
        return list(self.loaded_models.keys())
