import threading
import logging
from PIL import Image, ImageDraw
import pystray

logger = logging.getLogger(__name__)


def _create_icon_image(color="green"):
    """Create a simple colored circle icon."""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    colors = {"green": "#4CAF50", "yellow": "#FFC107", "red": "#F44336", "gray": "#9E9E9E"}
    fill = colors.get(color, colors["gray"])
    draw.ellipse([8, 8, 56, 56], fill=fill)
    return img


class TrayApp:
    """System tray icon with server lifecycle management."""

    def __init__(self, server_starter, server_stopper, unloader):
        self.server_starter = server_starter
        self.server_stopper = server_stopper
        self.unloader = unloader
        self.icon = None
        self._running = False

    def _build_menu(self):
        return pystray.Menu(
            pystray.MenuItem("JD Audio Service", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Unload Models", self._on_unload),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._on_quit),
        )

    def _on_unload(self, icon, item):
        logger.info("Manual model unload requested")
        self.unloader()
        icon.icon = _create_icon_image("gray")

    def _on_quit(self, icon, item):
        logger.info("Quit requested from tray")
        self._running = False
        self.server_stopper()
        icon.stop()

    def run(self):
        """Start tray icon and server. Blocks until quit."""
        self._running = True
        self.icon = pystray.Icon(
            "jd-audio-service",
            _create_icon_image("green"),
            "JD Audio Service",
            menu=self._build_menu(),
        )

        # Start server in background thread
        server_thread = threading.Thread(target=self.server_starter, daemon=True)
        server_thread.start()

        # Blocks until icon.stop() is called
        self.icon.run()
