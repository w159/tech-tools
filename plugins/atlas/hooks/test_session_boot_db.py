import json, os, subprocess, sys, tempfile, unittest

BOOT = os.path.join(os.path.dirname(__file__), "session_boot.py")


class BootDbTest(unittest.TestCase):
    def test_boot_creates_db_and_registers_run(self):
        tmp = tempfile.mkdtemp()
        env = dict(os.environ, ATLAS_DB=os.path.join(tmp, "atlas.db"))
        payload = json.dumps({"session_id": "sess-boot", "cwd": tmp})
        p = subprocess.run(
            [sys.executable, BOOT],
            input=payload,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(p.returncode, 0)
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(env["ATLAS_DB"])
        self.assertIsNotNone(atlas_db.current_run_id(conn, "sess-boot"))


if __name__ == "__main__":
    unittest.main()
