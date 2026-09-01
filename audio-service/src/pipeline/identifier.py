import numpy as np
from scipy.spatial.distance import cosine

# Cosine distance thresholds (per spec)
HIGH_CONFIDENCE_THRESHOLD = 0.25
MEDIUM_CONFIDENCE_THRESHOLD = 0.45


def identify_speakers(
    embeddings: list[dict],
    profiles: list[dict],
) -> list[dict]:
    """Match speaker embeddings against stored voice profiles using cosine distance.

    Args:
        embeddings: List of {speaker, vector} from current meeting.
        profiles: List of {name, vector} from stored voice profiles.

    Returns:
        List of {speaker, name, confidence, distance} matches.
    """
    if not embeddings:
        return []

    results = []
    for emb in embeddings:
        if not profiles:
            results.append({
                "speaker": emb["speaker"],
                "name": None,
                "confidence": 0.0,
                "distance": None,
            })
            continue

        emb_vec = np.array(emb["vector"], dtype=np.float32)
        best_distance = float("inf")
        best_name = None

        for prof in profiles:
            prof_vec = np.array(prof["vector"], dtype=np.float32)
            # Profiles enrolled under a different embedding model have a
            # different dimension — incomparable, and scipy cosine would
            # raise. Skip them (they re-enroll app-side).
            if prof_vec.shape != emb_vec.shape:
                continue
            dist = cosine(emb_vec, prof_vec)
            if dist < best_distance:
                best_distance = dist
                best_name = prof["name"]

        if best_distance <= HIGH_CONFIDENCE_THRESHOLD:
            confidence = 1.0 - (best_distance / HIGH_CONFIDENCE_THRESHOLD)
            confidence = 0.75 + 0.25 * confidence  # Scale to 0.75-1.0
        elif best_distance <= MEDIUM_CONFIDENCE_THRESHOLD:
            confidence = 0.5 + 0.25 * (1.0 - (best_distance - HIGH_CONFIDENCE_THRESHOLD) / (MEDIUM_CONFIDENCE_THRESHOLD - HIGH_CONFIDENCE_THRESHOLD))
        else:
            confidence = 0.0
            best_name = None

        results.append({
            "speaker": emb["speaker"],
            "name": best_name,
            "confidence": round(confidence, 3),
            # inf when every profile was dimension-skipped — not JSON-serializable
            "distance": None if best_distance == float("inf") else round(best_distance, 4),
        })

    return results
