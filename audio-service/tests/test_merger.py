from pipeline.merger import merge_transcript_with_diarization


class TestMerger:
    def test_simple_two_speaker_merge(self):
        """Two speakers, clean non-overlapping segments."""
        words = [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "there", "start": 0.6, "end": 1.0},
            {"word": "Hi", "start": 1.5, "end": 1.8},
            {"word": "back", "start": 1.9, "end": 2.2},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.2},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]
        entries = merge_transcript_with_diarization(words, segments)
        assert len(entries) == 2
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Hello there"
        assert entries[0]["timestamp"] == 0.0
        assert entries[1]["speaker"] == "SPEAKER_01"
        assert entries[1]["text"] == "Hi back"

    def test_single_speaker(self):
        words = [
            {"word": "Just", "start": 0.0, "end": 0.3},
            {"word": "me", "start": 0.4, "end": 0.6},
        ]
        segments = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}]
        entries = merge_transcript_with_diarization(words, segments)
        assert len(entries) == 1
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Just me"

    def test_speaker_change_mid_utterance(self):
        """Word midpoint determines which segment it belongs to."""
        words = [
            {"word": "Goodbye", "start": 0.8, "end": 1.4},
            {"word": "Hello", "start": 1.5, "end": 2.0},
        ]
        segments = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 1.3},
            {"speaker": "SPEAKER_01", "start": 1.3, "end": 2.5},
        ]
        entries = merge_transcript_with_diarization(words, segments)
        assert len(entries) == 2
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Goodbye"
        assert entries[1]["speaker"] == "SPEAKER_01"
        assert entries[1]["text"] == "Hello"

    def test_empty_words(self):
        entries = merge_transcript_with_diarization([], [{"speaker": "SPEAKER_00", "start": 0, "end": 1}])
        assert entries == []

    def test_empty_segments(self):
        words = [{"word": "Hello", "start": 0.0, "end": 0.5}]
        entries = merge_transcript_with_diarization(words, [])
        assert len(entries) == 1
        assert entries[0]["speaker"] == "Unknown"

    def test_words_outside_any_segment_assigned_to_nearest(self):
        words = [
            {"word": "Before", "start": 0.0, "end": 0.3},
            {"word": "During", "start": 1.0, "end": 1.3},
        ]
        segments = [{"speaker": "SPEAKER_00", "start": 0.8, "end": 1.5}]
        entries = merge_transcript_with_diarization(words, segments)
        # "Before" falls outside the segment but is nearest to SPEAKER_00
        assert len(entries) == 1
        assert entries[0]["speaker"] == "SPEAKER_00"
        assert entries[0]["text"] == "Before During"

    def test_consecutive_words_same_speaker_grouped(self):
        words = [
            {"word": "One", "start": 0.0, "end": 0.3},
            {"word": "two", "start": 0.4, "end": 0.6},
            {"word": "three", "start": 0.7, "end": 1.0},
        ]
        segments = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 2.0}]
        entries = merge_transcript_with_diarization(words, segments)
        assert len(entries) == 1
        assert entries[0]["text"] == "One two three"

    def test_words_include_timing_info(self):
        words = [{"word": "Hello", "start": 0.5, "end": 0.9, "confidence": 0.98}]
        segments = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0}]
        entries = merge_transcript_with_diarization(words, segments)
        assert entries[0]["words"][0]["word"] == "Hello"
        assert entries[0]["words"][0]["start"] == 0.5
        assert entries[0]["words"][0]["confidence"] == 0.98

    def test_many_words_many_segments_performance(self):
        import time
        words = [{"word": f"w{i}", "start": i * 0.1, "end": i * 0.1 + 0.08}
                 for i in range(1000)]
        segments = [{"speaker": f"S{i % 3}", "start": i * 3.0, "end": i * 3.0 + 2.9}
                    for i in range(35)]

        t0 = time.monotonic()
        entries = merge_transcript_with_diarization(words, segments)
        elapsed = time.monotonic() - t0

        assert len(entries) > 0
        assert elapsed < 1.0
