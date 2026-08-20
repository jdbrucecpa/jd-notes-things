import os
import logging
import threading
from functools import wraps
from fastapi import APIRouter, HTTPException, Request
from api.schemas import (
    ProcessRequest, ProcessResponse, ProcessingOptions,
    TranscribeRequest, TranscribeResponse,
    DiarizeRequest, DiarizeResponse,
    EmbedSpeakersRequest, EmbedSpeakersResponse,
    IdentifySpeakersRequest, IdentifySpeakersResponse,
    HealthResponse, ModelsResponse, UnloadResponse, WarmupResponse,
    TranscriptEntry, DiarizationSegment, SpeakerEmbedding,
    QualityInfo,
)
from config import VERSION
from pipeline.identifier import identify_speakers

logger = logging.getLogger(__name__)

router = APIRouter()

_gpu_lock = threading.Lock()


def get_model_manager(request: Request):
    return request.app.state.model_manager


def get_processor(request: Request):
    return request.app.state.processor


def _validate_audio_path(path: str) -> None:
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail=f"Audio file not found: {path}")


def _handle_gpu_errors(func):
    """Decorator that catches GPU errors and returns 503."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            err_str = str(e).lower()
            if "cuda" in err_str or "out of memory" in err_str or "gpu" in err_str:
                raise HTTPException(
                    status_code=503,
                    detail="GPU unavailable — close other GPU applications and retry, or switch to cloud transcription.",
                )
            raise
    return wrapper


@router.get("/health", response_model=HealthResponse)
def health(request: Request):
    mgr = get_model_manager(request)

    import torch
    if torch.cuda.is_available():
        device = f"cuda:0 ({torch.cuda.get_device_name(0)})"
    else:
        device = "cpu"

    return HealthResponse(
        status="idle" if not mgr.loaded_models else "ready",
        modelsLoaded=mgr.loaded_model_names(),
        device=device,
        engineVersion=VERSION,
    )


@router.post("/warmup", response_model=WarmupResponse)
def warmup(request: Request):
    """Kick off model loading in the background so the first real request
    doesn't pay the multi-minute load/download cost."""
    mgr = get_model_manager(request)

    def _load_all():
        with _gpu_lock:
            try:
                from models.transcriber import Transcriber
                mgr.get_or_load("transcriber", lambda: Transcriber())
            except Exception:
                logger.exception("Warmup failed loading transcriber")

            try:
                from models.diarizer import Diarizer
                mgr.get_or_load("diarizer", lambda: Diarizer())
            except Exception:
                logger.exception("Warmup failed loading diarizer")

            try:
                from models.embedder import Embedder
                mgr.get_or_load("embedder", lambda: Embedder())
            except Exception:
                logger.exception("Warmup failed loading embedder")

    threading.Thread(target=_load_all, daemon=True).start()
    return WarmupResponse(loading=["transcriber", "diarizer", "embedder"])


@router.get("/models", response_model=ModelsResponse)
def models():
    return ModelsResponse(
        transcription=["large-v3-turbo"],
        diarization=["pyannote-3.1"],
        embedding=["pyannote-embedding"],
    )


@router.post("/process", response_model=ProcessResponse)
@_handle_gpu_errors
def process(req: ProcessRequest, request: Request):
    _validate_audio_path(req.audioPath)
    proc = get_processor(request)

    opts = req.options or ProcessingOptions()

    with _gpu_lock:
        result = proc.process(
            audio_path=req.audioPath,
            min_speakers=opts.minSpeakers,
            max_speakers=opts.maxSpeakers,
        )

    quality_data = result.get("quality")
    quality = QualityInfo(**quality_data) if quality_data else None

    return ProcessResponse(
        text=result["text"],
        entries=[TranscriptEntry(**e) for e in result["entries"]],
        segments=[DiarizationSegment(**s) for s in result["segments"]],
        duration=result["duration"],
        quality=quality,
    )


@router.post("/transcribe", response_model=TranscribeResponse)
@_handle_gpu_errors
def transcribe(req: TranscribeRequest, request: Request):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager(request)

    def _load_transcriber():
        from models.transcriber import Transcriber
        return Transcriber()

    transcriber = mgr.get_or_load("transcriber", _load_transcriber)

    with _gpu_lock:
        result = transcriber.transcribe(req.audioPath)

    entries = []
    for seg in result.get("segments", []):
        seg_words = [w for w in result["words"] if w["start"] >= seg["start"] and w["end"] <= seg["end"]]
        entries.append(TranscriptEntry(
            text=seg["text"] if "text" in seg else " ".join(w["word"] for w in seg_words),
            timestamp=seg["start"],
            words=seg_words,
        ))
    if not entries:
        entries = [TranscriptEntry(text=result["text"], timestamp=0.0, words=result["words"])]

    return TranscribeResponse(text=result["text"], entries=entries, duration=result["duration"])


@router.post("/diarize", response_model=DiarizeResponse)
@_handle_gpu_errors
def diarize(req: DiarizeRequest, request: Request):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager(request)

    def _load_diarizer():
        from models.diarizer import Diarizer
        return Diarizer()

    diarizer = mgr.get_or_load("diarizer", _load_diarizer)

    with _gpu_lock:
        segments = diarizer.diarize(
            req.audioPath,
            num_speakers=req.numSpeakers,
            min_speakers=req.minSpeakers,
            max_speakers=req.maxSpeakers,
        )

    return DiarizeResponse(segments=[DiarizationSegment(**s) for s in segments])


@router.post("/embed-speakers", response_model=EmbedSpeakersResponse)
@_handle_gpu_errors
def embed_speakers(req: EmbedSpeakersRequest, request: Request):
    _validate_audio_path(req.audioPath)
    mgr = get_model_manager(request)

    def _load_embedder():
        from models.embedder import Embedder
        return Embedder()

    embedder = mgr.get_or_load("embedder", _load_embedder)
    segments_raw = [{"speaker": s.speaker, "start": s.start, "end": s.end} for s in req.segments]

    with _gpu_lock:
        results = embedder.embed_segments(req.audioPath, segments_raw)

    return EmbedSpeakersResponse(
        embeddings=[SpeakerEmbedding(**e) for e in results]
    )


@router.post("/identify-speakers", response_model=IdentifySpeakersResponse)
def identify(req: IdentifySpeakersRequest):
    emb_dicts = [{"speaker": e.speaker, "vector": e.vector} for e in req.embeddings]
    prof_dicts = [{"name": p.name, "vector": p.vector} for p in req.profiles]

    matches = identify_speakers(emb_dicts, prof_dicts)

    return IdentifySpeakersResponse(
        matches=[
            {"speaker": m["speaker"], "name": m["name"], "confidence": m["confidence"], "distance": m["distance"]}
            for m in matches
        ]
    )


@router.post("/unload", response_model=UnloadResponse)
def unload(request: Request):
    mgr = get_model_manager(request)
    mgr.unload_all()
    return UnloadResponse(status="unloaded", vramFreed=0.0)
