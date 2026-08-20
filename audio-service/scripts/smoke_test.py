"""Smoke test: start real HTTP server and verify all endpoints."""
import subprocess
import sys
import time
import httpx
from pathlib import Path

BASE = "http://127.0.0.1:8374"
AUDIO = str((Path(__file__).parent.parent / "fixtures" / "two_speakers_short.wav").resolve())


def wait_for_server(timeout=30):
    for _ in range(timeout):
        try:
            resp = httpx.get(f"{BASE}/health", timeout=2)
            if resp.status_code == 200:
                return True
        except httpx.ConnectError:
            time.sleep(1)
    return False


def main():
    print("Starting server in headless mode...", flush=True)
    proc = subprocess.Popen(
        [sys.executable, "src/main.py", "--no-tray"],
        cwd=str(Path(__file__).parent.parent),
    )

    try:
        if not wait_for_server():
            print("FAIL: Server did not start within 30s")
            return 1

        print("Server is up. Running smoke tests...\n", flush=True)

        # GET /health
        print("[1/5] GET /health")
        resp = httpx.get(f"{BASE}/health", timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "device" in data, "Missing device field"
        print(f"  OK — status={data['status']}, device={data['device']}\n")

        # GET /models
        print("[2/5] GET /models")
        resp = httpx.get(f"{BASE}/models", timeout=10)
        assert resp.status_code == 200
        data = resp.json()
        assert "large-v3-turbo" in data["transcription"]
        print(f"  OK — transcription={data['transcription']}\n")

        # POST /process (short fixture — loads models, may take 30-60s)
        print("[3/5] POST /process (loading models, may take 30-60s)...")
        resp = httpx.post(f"{BASE}/process", json={
            "audioPath": AUDIO,
            "options": {"minSpeakers": 2, "maxSpeakers": 2},
        }, timeout=300)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
        data = resp.json()
        assert len(data["text"]) > 0, "Empty transcript"
        assert len(data["entries"]) > 0, "No entries"
        assert data["duration"] > 0, "Zero duration"
        speakers = set(e["speaker"] for e in data["entries"])
        print(f"  OK — {len(data['entries'])} entries, {len(speakers)} speakers, {data['duration']:.1f}s\n")

        # POST /unload
        print("[4/5] POST /unload")
        resp = httpx.post(f"{BASE}/unload", timeout=30)
        assert resp.status_code == 200
        print(f"  OK — {resp.json()}\n")

        # GET /health (verify idle after unload)
        print("[5/5] GET /health (after unload)")
        resp = httpx.get(f"{BASE}/health", timeout=10)
        data = resp.json()
        assert data["status"] == "idle"
        assert data["modelsLoaded"] == []
        print(f"  OK — status={data['status']}, models={data['modelsLoaded']}\n")

        print("=" * 50)
        print("ALL SMOKE TESTS PASSED")
        print("=" * 50)
        return 0

    except Exception as e:
        print(f"\nFAIL: {e}")
        import traceback
        traceback.print_exc()
        return 1

    finally:
        print("\nStopping server...")
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
