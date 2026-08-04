import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import hotmail_helper


class HotmailHelperSessionJsonlTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.target_path = Path(self.temp_dir.name) / "chatgpt-session.jsonl"
        self.original_target_path = hotmail_helper.CHATGPT_SESSION_JSONL_PATH
        hotmail_helper.CHATGPT_SESSION_JSONL_PATH = str(self.target_path)

    def tearDown(self):
        hotmail_helper.CHATGPT_SESSION_JSONL_PATH = self.original_target_path
        self.temp_dir.cleanup()

    def test_append_preserves_records_and_normalizes_newlines(self):
        first_line = '{"account":"first"}'
        second_line = '{"account":"second"}'

        first_path = hotmail_helper.append_chatgpt_session_json_line(first_line)
        second_path = hotmail_helper.append_chatgpt_session_json_line('{"account":\n"second"}\r\n')

        self.assertEqual(first_path, str(self.target_path))
        self.assertEqual(second_path, str(self.target_path))
        self.assertEqual(
            self.target_path.read_text(encoding="utf-8"),
            first_line + "\n" + second_line + "\n",
        )
        self.assertEqual(self.target_path.read_text(encoding="utf-8").count("\n"), 2)

    def test_append_rejects_content_that_is_empty_after_newline_removal(self):
        with self.assertRaises(RuntimeError):
            hotmail_helper.append_chatgpt_session_json_line("\r\n")

        self.assertFalse(self.target_path.exists())

    def test_post_route_appends_content_and_returns_absolute_path(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), hotmail_helper.HotmailHelperHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            payload = json.dumps({"content": '{"account":\n"route"}'}).encode("utf-8")
            request = Request(
                f"http://127.0.0.1:{server.server_address[1]}/append-chatgpt-session",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=5) as response:
                response_payload = json.loads(response.read().decode("utf-8"))

            self.assertEqual(response_payload, {"ok": True, "filePath": str(self.target_path)})
            self.assertEqual(self.target_path.read_text(encoding="utf-8"), '{"account":"route"}\n')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_post_route_rejects_missing_content(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), hotmail_helper.HotmailHelperHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            payload = json.dumps({}).encode("utf-8")
            request = Request(
                f"http://127.0.0.1:{server.server_address[1]}/append-chatgpt-session",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(HTTPError) as raised:
                urlopen(request, timeout=5)
            self.assertEqual(raised.exception.code, 500)
            response_payload = json.loads(raised.exception.read().decode("utf-8"))
            self.assertEqual(response_payload["ok"], False)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
