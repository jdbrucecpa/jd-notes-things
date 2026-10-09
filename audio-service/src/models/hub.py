"""Hugging Face cache status and prefetch for the gated PyAnnote models.

The models load lazily mid-request, so on a fresh machine a missing token
used to surface only as a 500 minutes into the first transcription. These
helpers let the app check readiness up front and download the models as
soon as a token is saved.

Once a model is cached it loads without a token (huggingface_hub falls back
to the cache when the revision check is refused), so the token is only
needed for the first download.
"""
import logging
from config import DIARIZATION_MODEL, EMBEDDING_MODEL

logger = logging.getLogger(__name__)

GATED_MODELS = {
    "diarizer": DIARIZATION_MODEL,
    "embedder": EMBEDDING_MODEL,
}


def _is_cached(repo_id: str) -> bool:
    from huggingface_hub import snapshot_download
    from huggingface_hub.errors import LocalEntryNotFoundError

    try:
        snapshot_download(repo_id, local_files_only=True)
        return True
    except LocalEntryNotFoundError:
        return False


def _describe_error(repo_id: str, err: Exception, has_token: bool) -> str:
    from huggingface_hub.errors import GatedRepoError, RepositoryNotFoundError

    if isinstance(err, (GatedRepoError, RepositoryNotFoundError)):
        status = getattr(getattr(err, "response", None), "status_code", None)
        if status == 403:
            return (
                f"Your Hugging Face account hasn't accepted the terms for {repo_id} — "
                f"accept them at https://huggingface.co/{repo_id}"
            )
        if not has_token:
            return "A Hugging Face token is required to download this model"
        return "Hugging Face rejected the token — check it in Settings"
    return f"Download failed: {err}"


def model_status() -> list[dict]:
    return [
        {"name": name, "repo": repo, "cached": _is_cached(repo), "error": None}
        for name, repo in GATED_MODELS.items()
    ]


def prefetch_models(token: str | None) -> list[dict]:
    """Download any gated model that isn't cached yet. Never raises —
    per-model failures are reported in the result so one bad model doesn't
    hide the status of the others."""
    from huggingface_hub import snapshot_download

    results = []
    for name, repo in GATED_MODELS.items():
        entry = {"name": name, "repo": repo, "cached": False, "error": None}
        try:
            if not _is_cached(repo):
                logger.info(f"Prefetching {repo}")
                snapshot_download(repo, token=token or None)
            entry["cached"] = True
        except Exception as err:
            logger.warning(f"Prefetch failed for {repo}: {err}")
            entry["error"] = _describe_error(repo, err, has_token=bool(token))
        results.append(entry)
    return results
