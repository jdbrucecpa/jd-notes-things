"""Audio loading via soundfile + torch.

Workaround for torchcodec incompatibility with nightly PyTorch.
PyAnnote accepts {'waveform': tensor, 'sample_rate': int} dicts
as an alternative to file paths.
"""

import soundfile as sf
import torch


def load_audio(audio_path: str) -> dict:
    """Load audio file into a PyAnnote-compatible waveform dict.

    Args:
        audio_path: Path to audio file (WAV, FLAC, OGG).

    Returns:
        dict with 'waveform' (channel, time) tensor and 'sample_rate' int.
    """
    data, sample_rate = sf.read(audio_path, dtype="float32")

    waveform = torch.from_numpy(data)
    # soundfile returns (samples,) for mono, (samples, channels) for stereo
    # PyAnnote expects (channels, samples)
    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    else:
        waveform = waveform.T

    return {"waveform": waveform, "sample_rate": sample_rate}
