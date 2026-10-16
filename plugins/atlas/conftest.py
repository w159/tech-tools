"""Test hermeticity: no pytest run may reach the live herdr server (a real pane named `w` with a tmp cwd is a leak).
Tests that need a herdr socket set HERDR_SOCKET_PATH to their own fake."""
import os
import tempfile

os.environ["HERDR_SOCKET_PATH"] = os.path.join(tempfile.gettempdir(), "atlas-pytest-no-herdr.sock")
