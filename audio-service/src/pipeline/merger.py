from bisect import bisect_right


def _find_speaker_for_word(word: dict, segments: list[dict],
                           starts: list[float] | None = None) -> str:
    """Find which speaker segment a word belongs to, using word midpoint.

    Uses binary search when a pre-built starts index is provided.
    Falls back to nearest segment for words in gaps.
    """
    midpoint = (word["start"] + word["end"]) / 2

    if starts is not None:
        idx = bisect_right(starts, midpoint) - 1
        if idx >= 0 and segments[idx]["start"] <= midpoint <= segments[idx]["end"]:
            return segments[idx]["speaker"]
        if idx + 1 < len(segments) and segments[idx + 1]["start"] <= midpoint <= segments[idx + 1]["end"]:
            return segments[idx + 1]["speaker"]
    else:
        for seg in segments:
            if seg["start"] <= midpoint <= seg["end"]:
                return seg["speaker"]

    # No exact match — find nearest segment
    if not segments:
        return "Unknown"

    best_speaker = segments[0]["speaker"]
    best_distance = float("inf")
    for seg in segments:
        dist = min(abs(midpoint - seg["start"]), abs(midpoint - seg["end"]))
        if dist < best_distance:
            best_distance = dist
            best_speaker = seg["speaker"]

    return best_speaker


def merge_transcript_with_diarization(
    words: list[dict],
    segments: list[dict],
) -> list[dict]:
    """Align word-level transcription with speaker diarization segments.

    Groups consecutive words from the same speaker into transcript entries.

    Args:
        words: List of {word, start, end, confidence?} from transcription.
        segments: List of {speaker, start, end} from diarization.

    Returns:
        List of transcript entries: {speaker, text, timestamp, words}.
    """
    if not words:
        return []

    if not segments:
        segments = []

    starts = [seg["start"] for seg in segments] if segments else None

    entries = []
    current_speaker = None
    current_words = []
    current_timestamp = 0.0

    for word in words:
        speaker = _find_speaker_for_word(word, segments, starts)

        if speaker != current_speaker and current_words:
            entries.append({
                "speaker": current_speaker,
                "text": " ".join(w["word"] for w in current_words),
                "timestamp": current_timestamp,
                "words": [{k: v for k, v in w.items()} for w in current_words],
            })
            current_words = []

        if not current_words:
            current_timestamp = word["start"]
            current_speaker = speaker

        current_words.append(word)

    if current_words:
        entries.append({
            "speaker": current_speaker,
            "text": " ".join(w["word"] for w in current_words),
            "timestamp": current_timestamp,
            "words": [{k: v for k, v in w.items()} for w in current_words],
        })

    return entries
