import sys
import logging
import threading
import time
import uvicorn
from config import HOST, PORT, IDLE_TIMEOUT_SECONDS
from models.manager import ModelManager
from server import create_app
from tray.app import TrayApp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

_uvicorn_server = None
_model_manager = None


def start_server():
    global _uvicorn_server
    app = create_app(_model_manager)
    config = uvicorn.Config(app, host=HOST, port=PORT, log_level="info")
    _uvicorn_server = uvicorn.Server(config)
    _uvicorn_server.run()


def stop_server():
    if _uvicorn_server:
        _uvicorn_server.should_exit = True


def unload_models():
    if _model_manager:
        _model_manager.unload_all()


def idle_collector_loop():
    """Background thread that periodically unloads idle models."""
    while True:
        time.sleep(60)  # Check every minute
        if _model_manager:
            _model_manager.collect_idle()


def main():
    global _model_manager

    _model_manager = ModelManager(idle_timeout_seconds=IDLE_TIMEOUT_SECONDS)

    # Start idle collector
    collector = threading.Thread(target=idle_collector_loop, daemon=True)
    collector.start()

    if "--no-tray" in sys.argv:
        # Headless mode (for development/testing)
        logger.info(f"Starting JD Audio Service on {HOST}:{PORT} (headless)")
        start_server()
    else:
        logger.info(f"Starting JD Audio Service on {HOST}:{PORT}")
        tray = TrayApp(start_server, stop_server, unload_models)
        tray.run()


if __name__ == "__main__":
    main()
