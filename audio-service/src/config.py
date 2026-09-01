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
DIARIZATION_MODEL = "pyannote/speaker-diarization-community-1"
# wespeaker resnet34-LM (~1% EER) replaced the 2020-era pyannote/embedding
# (~2.8% EER) on 2026-09-01. Embeddings from different models are NOT
# comparable — voice profiles enrolled under the old model are re-founded
# by the app on their next sample (see voiceProfileService.js).
EMBEDDING_MODEL = "pyannote/wespeaker-voxceleb-resnet34-LM"

# Version
VERSION = "0.3.0"
