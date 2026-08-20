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

# Whisper model config (CTranslate2)
TRANSCRIPTION_MODEL = "large-v3-turbo"
TRANSCRIPTION_DEVICE = os.getenv("JD_AUDIO_DEVICE", "cuda")
TRANSCRIPTION_COMPUTE_TYPE = os.getenv("JD_AUDIO_COMPUTE_TYPE", "float16")

# Alignment model
ALIGNMENT_MODEL = "WAV2VEC2_ASR_BASE_960H"

# PyAnnote model identifiers
DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"
EMBEDDING_MODEL = "pyannote/embedding"

# Version
VERSION = "0.2.0"
