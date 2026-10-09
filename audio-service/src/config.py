import os
from pathlib import Path

HOST = os.getenv("JD_AUDIO_HOST", "127.0.0.1")
PORT = int(os.getenv("JD_AUDIO_PORT", "8374"))

MODEL_CACHE_DIR = Path(os.getenv(
    "JD_AUDIO_MODEL_DIR",
    os.path.join(os.getenv("APPDATA", ""), "JDAudioService", "models")
))

# Auto-unload models after this many seconds of inactivity
IDLE_TIMEOUT_SECONDS = int(os.getenv("JD_AUDIO_IDLE_TIMEOUT", "300"))

# GPU memory strategy. "low" keeps only the current pipeline stage's model
# on the GPU; "high" keeps every model resident between requests. "auto"
# picks "low" on GPUs with <= LOW_VRAM_THRESHOLD_GB. On an 8 GB laptop GPU,
# keeping everything resident overflowed VRAM during diarization and the
# Windows driver silently spilled into system RAM — an hour-long meeting
# took 20+ minutes instead of ~6.
GPU_MEMORY_MODE = os.getenv("JD_AUDIO_GPU_MEMORY_MODE", "auto").lower()
LOW_VRAM_THRESHOLD_GB = float(os.getenv("JD_AUDIO_LOW_VRAM_GB", "12"))

# Whisper model config (CTranslate2)
TRANSCRIPTION_MODEL = "large-v3-turbo"
TRANSCRIPTION_DEVICE = os.getenv("JD_AUDIO_DEVICE", "cuda")
TRANSCRIPTION_COMPUTE_TYPE = os.getenv("JD_AUDIO_COMPUTE_TYPE", "float16")

# Alignment model
ALIGNMENT_MODEL = "WAV2VEC2_ASR_BASE_960H"

# PyAnnote model identifiers
DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
# wespeaker resnet34-LM (~1% EER) replaced the 2020-era pyannote/embedding
# (~2.8% EER) on 2026-09-01. Embeddings from different models are NOT
# comparable — voice profiles enrolled under the old model are re-founded
# by the app on their next sample (see voiceProfileService.js).
EMBEDDING_MODEL = "pyannote/wespeaker-voxceleb-resnet34-LM"

# Version
VERSION = "0.3.0"
