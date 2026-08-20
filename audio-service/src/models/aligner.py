import logging
import soundfile as sf
import torch
import torchaudio.functional as F
from torchaudio.pipelines import WAV2VEC2_ASR_BASE_960H
from config import ALIGNMENT_MODEL

logger = logging.getLogger(__name__)


class Aligner:
    """Refines word timestamps via wav2vec2 forced alignment.

    Uses torchaudio CTC forced alignment API: forced_align() produces
    frame-level token predictions, merge_tokens() collapses them into
    token spans with start/end frame indices.
    """

    def __init__(self):
        logger.info("Loading alignment model: %s", ALIGNMENT_MODEL)
        bundle = WAV2VEC2_ASR_BASE_960H
        self.model = bundle.get_model()
        if torch.cuda.is_available():
            self.model = self.model.to("cuda")
        self.labels = bundle.get_labels()
        self.sample_rate = bundle.sample_rate
        self.blank_id = 0  # CTC blank token
        # Build label-to-index lookup
        # labels[0]='-' (blank), labels[1]='|' (word boundary)
        self.label_to_idx = {label: i for i, label in enumerate(self.labels)}
        self.word_boundary_idx = self.label_to_idx.get("|", -1)
        self.model.eval()
        logger.info("Alignment model loaded")

    def align(self, audio_path, transcription):
        """Refine word timestamps via forced alignment.

        Processes one segment at a time to avoid OOM on long audio.
        Falls back to original timestamps for any segment that fails.

        Args:
            audio_path: Path to audio file.
            transcription: Dict with text, words, segments, duration, quality.

        Returns:
            Same dict with refined word timestamps.
        """
        try:
            data, sr = sf.read(audio_path, dtype="float32")
            waveform = torch.from_numpy(data)
            if waveform.ndim == 1:
                waveform = waveform.unsqueeze(0)
            else:
                waveform = waveform.T
            if sr != self.sample_rate:
                waveform = F.resample(waveform, sr, self.sample_rate)
            device = next(self.model.parameters()).device
            waveform = waveform.to(device)
        except Exception as e:
            logger.warning("Failed to load audio for alignment: %s", e)
            return transcription

        refined_words = []
        covered_ids = set()

        for seg in transcription["segments"]:
            seg_words = [
                w for w in transcription["words"]
                if w["start"] >= seg["start"] and w["end"] <= seg["end"]
            ]
            if not seg_words:
                continue

            try:
                aligned = self._align_segment(waveform, seg, seg_words)
                refined_words.extend(aligned)
            except Exception as e:
                logger.debug("Alignment failed for segment at %.1fs: %s", seg["start"], e)
                refined_words.extend(seg_words)

            for w in seg_words:
                covered_ids.add(id(w))

        # Include words not covered by any segment
        for w in transcription["words"]:
            if id(w) not in covered_ids:
                refined_words.append(w)

        refined_words.sort(key=lambda w: w["start"])
        transcription["words"] = refined_words
        return transcription

    def _align_segment(self, waveform, seg, words):
        """Align a single segment using CTC forced alignment."""
        start_sample = int(seg["start"] * self.sample_rate)
        end_sample = int(seg["end"] * self.sample_rate)
        segment_waveform = waveform[:, start_sample:end_sample]

        if segment_waveform.shape[1] == 0:
            return words

        # Get emission probabilities from wav2vec2
        with torch.inference_mode():
            emission, _ = self.model(segment_waveform)
        log_probs = torch.log_softmax(emission, dim=-1)

        # Build token sequence: "HELLO | WORLD"
        # (| = word boundary token in wav2vec2 vocabulary)
        transcript_text = " ".join(w["word"] for w in words).upper()
        tokens = []
        for char in transcript_text:
            if char == " ":
                if self.word_boundary_idx >= 0:
                    tokens.append(self.word_boundary_idx)
            elif char in self.label_to_idx:
                tokens.append(self.label_to_idx[char])
            # Skip characters not in the label set (punctuation, numbers)

        if not tokens:
            return words

        # Run CTC forced alignment
        targets = torch.tensor([tokens], device=log_probs.device)
        aligned_tokens, scores = F.forced_align(
            log_probs, targets, blank=self.blank_id
        )

        # merge_tokens collapses frame-level predictions into spans
        # Each span has .token (int), .start (frame), .end (frame), .score
        token_spans = F.merge_tokens(aligned_tokens[0], scores[0])

        # Convert frame indices to seconds
        ratio = segment_waveform.shape[1] / emission.shape[1]

        # Group token spans into words (split on word boundary token)
        word_spans = []
        current_word_tokens = []
        for span in token_spans:
            if span.token == self.word_boundary_idx:
                if current_word_tokens:
                    word_spans.append(current_word_tokens)
                    current_word_tokens = []
            else:
                current_word_tokens.append(span)
        if current_word_tokens:
            word_spans.append(current_word_tokens)

        # Map word spans back to the original word list
        refined = []
        for i, word in enumerate(words):
            if i < len(word_spans) and word_spans[i]:
                spans = word_spans[i]
                start_t = seg["start"] + (spans[0].start * ratio / self.sample_rate)
                end_t = seg["start"] + (spans[-1].end * ratio / self.sample_rate)
                refined.append({
                    **word,
                    "start": round(start_t, 3),
                    "end": round(end_t, 3),
                })
            else:
                refined.append(word)

        return refined
