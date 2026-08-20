import numpy as np
from pipeline.identifier import identify_speakers


class TestIdentifySpeakers:
    def test_identical_vectors_perfect_match(self):
        vec = [0.1] * 256
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": vec}],
            profiles=[{"name": "Tim", "vector": vec}],
        )
        assert len(matches) == 1
        assert matches[0]["name"] == "Tim"
        assert matches[0]["distance"] < 0.01
        assert matches[0]["confidence"] > 0.9

    def test_orthogonal_vectors_no_match(self):
        vec_a = [1.0] + [0.0] * 255
        vec_b = [0.0, 1.0] + [0.0] * 254
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": vec_a}],
            profiles=[{"name": "Tim", "vector": vec_b}],
        )
        assert matches[0]["name"] is None
        assert matches[0]["confidence"] < 0.5

    def test_close_vectors_match(self):
        rng = np.random.default_rng(42)
        base = rng.standard_normal(256).tolist()
        similar = [b + 0.05 * n for b, n in zip(base, rng.standard_normal(256))]
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": base}],
            profiles=[{"name": "Tim", "vector": similar}],
        )
        assert matches[0]["name"] == "Tim"
        assert matches[0]["confidence"] > 0.5

    def test_best_match_selected_from_multiple_profiles(self):
        target = [1.0, 0.0] + [0.0] * 254
        close = [0.95, 0.05] + [0.0] * 254
        far = [0.0, 1.0] + [0.0] * 254
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": target}],
            profiles=[
                {"name": "Tim", "vector": close},
                {"name": "Sarah", "vector": far},
            ],
        )
        assert matches[0]["name"] == "Tim"

    def test_no_profiles_returns_no_matches(self):
        matches = identify_speakers(
            embeddings=[{"speaker": "Speaker 1", "vector": [0.1] * 256}],
            profiles=[],
        )
        assert matches[0]["name"] is None

    def test_no_embeddings_returns_empty(self):
        matches = identify_speakers(embeddings=[], profiles=[])
        assert matches == []

    def test_multiple_speakers_matched_independently(self):
        vec_a = [1.0, 0.0] + [0.0] * 254
        vec_b = [0.0, 1.0] + [0.0] * 254
        matches = identify_speakers(
            embeddings=[
                {"speaker": "Speaker 1", "vector": vec_a},
                {"speaker": "Speaker 2", "vector": vec_b},
            ],
            profiles=[
                {"name": "Tim", "vector": vec_a},
                {"name": "Sarah", "vector": vec_b},
            ],
        )
        names = {m["speaker"]: m["name"] for m in matches}
        assert names["Speaker 1"] == "Tim"
        assert names["Speaker 2"] == "Sarah"
