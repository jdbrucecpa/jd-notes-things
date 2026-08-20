import logging
from fastapi import FastAPI
from models.manager import ModelManager
from pipeline.processor import Processor
from api.routes import router
from config import VERSION

logger = logging.getLogger(__name__)


def create_app(
    model_manager: ModelManager | None = None,
    processor: Processor | None = None,
) -> FastAPI:
    if model_manager is None:
        model_manager = ModelManager()
    if processor is None:
        processor = Processor(model_manager)

    app = FastAPI(
        title="JD Audio Service",
        version=VERSION,
        description="Local audio transcription, diarization, and speaker identification",
    )
    app.state.model_manager = model_manager
    app.state.processor = processor
    app.include_router(router)

    return app
