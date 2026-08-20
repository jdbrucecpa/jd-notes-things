from pydantic import BaseModel


class ProcessingOptions(BaseModel):
    speakerNames: list[str] | None = None
    minSpeakers: int | None = None
    maxSpeakers: int | None = None
    vocabulary: list[str] | None = None


# --- Shared types ---

class WordTiming(BaseModel):
    word: str
    start: float
    end: float
    confidence: float | None = None


class TranscriptEntry(BaseModel):
    speaker: str | None = None
    text: str
    timestamp: float
    words: list[WordTiming] = []


class DiarizationSegment(BaseModel):
    speaker: str
    start: float
    end: float


class SpeakerEmbedding(BaseModel):
    speaker: str
    vector: list[float]
    duration: float = 0.0


class SpeakerMatch(BaseModel):
    speaker: str
    name: str | None = None
    confidence: float
    distance: float | None = None


class SpeakerProfile(BaseModel):
    name: str
    vector: list[float]
    duration: float = 0.0


# --- Request/Response pairs ---

class ProcessRequest(BaseModel):
    audioPath: str
    options: ProcessingOptions | None = None


class QualityInfo(BaseModel):
    flagged_segments: list[int] = []
    avg_confidence: float = 0.0


class ProcessResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    segments: list[DiarizationSegment]
    duration: float
    quality: QualityInfo | None = None


class TranscribeRequest(BaseModel):
    audioPath: str
    options: ProcessingOptions | None = None


class TranscribeResponse(BaseModel):
    text: str
    entries: list[TranscriptEntry]
    duration: float


class DiarizeRequest(BaseModel):
    audioPath: str
    numSpeakers: int | None = None
    minSpeakers: int | None = None
    maxSpeakers: int | None = None


class DiarizeResponse(BaseModel):
    segments: list[DiarizationSegment]


class EmbedSpeakersRequest(BaseModel):
    audioPath: str
    segments: list[DiarizationSegment]


class EmbedSpeakersResponse(BaseModel):
    embeddings: list[SpeakerEmbedding]


class IdentifySpeakersRequest(BaseModel):
    embeddings: list[SpeakerEmbedding]
    profiles: list[SpeakerProfile]


class IdentifySpeakersResponse(BaseModel):
    matches: list[SpeakerMatch]


class HealthResponse(BaseModel):
    status: str
    modelsLoaded: list[str]
    device: str
    engineVersion: str


class ModelsResponse(BaseModel):
    transcription: list[str]
    diarization: list[str]
    embedding: list[str]
    alignment: list[str] = []


class UnloadResponse(BaseModel):
    status: str
    vramFreed: float


class WarmupResponse(BaseModel):
    loading: list[str]
