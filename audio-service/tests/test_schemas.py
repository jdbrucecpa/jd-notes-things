import pytest
from api.schemas import (
    ProcessRequest, ProcessResponse, TranscribeRequest, TranscribeResponse,
    DiarizeRequest, DiarizeResponse, EmbedSpeakersRequest, EmbedSpeakersResponse,
    IdentifySpeakersRequest, IdentifySpeakersResponse,
    HealthResponse, ModelsResponse, UnloadResponse,
    TranscriptEntry, DiarizationSegment, SpeakerEmbedding, SpeakerProfile, SpeakerMatch,
    ProcessingOptions,
)


class TestProcessRequest:
    def test_valid_request(self):
        req = ProcessRequest(audioPath="C:/recordings/test.mp3")
        assert req.audioPath == "C:/recordings/test.mp3"
        assert req.options is None

    def test_with_options(self):
        req = ProcessRequest(
            audioPath="/path/to/file.wav",
            options=ProcessingOptions(
                speakerNames=["Tim", "Sarah"],
                minSpeakers=2,
                maxSpeakers=5,
                vocabulary=["Obsidian"],
            ),
        )
        assert req.options.speakerNames == ["Tim", "Sarah"]
        assert req.options.minSpeakers == 2

    def test_missing_audio_path_fails(self):
        with pytest.raises(Exception):
            ProcessRequest()


class TestProcessResponse:
    def test_valid_response(self):
        resp = ProcessResponse(
            text="Hello world",
            entries=[
                TranscriptEntry(speaker="Speaker 1", text="Hello", timestamp=0.0, words=[]),
                TranscriptEntry(speaker="Speaker 2", text="World", timestamp=1.5, words=[]),
            ],
            segments=[
                DiarizationSegment(speaker="Speaker 1", start=0.0, end=1.2),
                DiarizationSegment(speaker="Speaker 2", start=1.3, end=2.5),
            ],
            duration=2.5,
        )
        assert len(resp.entries) == 2
        assert resp.duration == 2.5


class TestIdentifySpeakers:
    def test_valid_request(self):
        req = IdentifySpeakersRequest(
            embeddings=[SpeakerEmbedding(speaker="Speaker 1", vector=[0.1] * 256, duration=30.0)],
            profiles=[SpeakerProfile(name="Tim", vector=[0.1] * 256, duration=120.0)],
        )
        assert len(req.embeddings) == 1

    def test_valid_response(self):
        resp = IdentifySpeakersResponse(
            matches=[SpeakerMatch(speaker="Speaker 1", name="Tim", confidence=0.94, distance=0.12)]
        )
        assert resp.matches[0].confidence == 0.94


class TestHealthResponse:
    def test_valid_response(self):
        resp = HealthResponse(
            status="idle",
            modelsLoaded=["parakeet-tdt-0.6b-v2"],
            device="cpu",
            engineVersion="0.1.0",
        )
        assert resp.status == "idle"


class TestQualityInfo:
    def test_quality_info_defaults(self):
        from api.schemas import QualityInfo
        q = QualityInfo()
        assert q.flagged_segments == []
        assert q.avg_confidence == 0.0

    def test_process_response_with_quality(self):
        from api.schemas import ProcessResponse, QualityInfo
        resp = ProcessResponse(
            text="Hello",
            entries=[],
            segments=[],
            duration=1.0,
            quality=QualityInfo(flagged_segments=[2], avg_confidence=0.85),
        )
        assert resp.quality.flagged_segments == [2]

    def test_process_response_quality_optional(self):
        from api.schemas import ProcessResponse
        resp = ProcessResponse(text="Hello", entries=[], segments=[], duration=1.0)
        assert resp.quality is None
