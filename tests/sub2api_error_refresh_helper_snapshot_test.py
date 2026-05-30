import importlib.util
import json
import os
import tempfile
import unittest


def load_hotmail_helper_module():
    base_dir = os.path.dirname(os.path.dirname(__file__))
    file_path = os.path.join(base_dir, "scripts", "hotmail_helper.py")
    spec = importlib.util.spec_from_file_location("hotmail_helper", file_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class Sub2ApiErrorRefreshHelperSnapshotTest(unittest.TestCase):
    def test_sync_sub2api_error_refresh_records_keeps_all_entries(self):
        module = load_hotmail_helper_module()
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_path = os.path.join(temp_dir, "sub2api-error-refresh-history.json")
            original_path = module.SUB2API_ERROR_REFRESH_SNAPSHOT_PATH
            try:
                module.SUB2API_ERROR_REFRESH_SNAPSHOT_PATH = snapshot_path
                result_path = module.sync_sub2api_error_refresh_records({
                    "generatedAt": "2026-05-28T10:00:00.000Z",
                    "runs": [
                        {
                            "runId": "run_1",
                            "startedAt": "2026-05-28T09:59:00.000Z",
                            "finishedAt": "2026-05-28T10:00:00.000Z",
                            "totalRemoteErrors": 2,
                            "details": [
                                {
                                    "email": "missing@example.com",
                                    "remoteAccountId": 2,
                                    "localAccountId": "",
                                    "category": "not_found_locally",
                                    "reason": "本地邮箱池未找到对应账号",
                                    "processedAt": "2026-05-28T09:59:30.000Z",
                                },
                                {
                                    "email": "revived@example.com",
                                    "remoteAccountId": 1,
                                    "localAccountId": "hm_1",
                                    "category": "synced_success",
                                    "planType": "plus",
                                    "processedAt": "2026-05-28T09:59:10.000Z",
                                },
                            ],
                        }
                    ],
                })
                self.assertEqual(result_path, snapshot_path)
                with open(snapshot_path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                self.assertEqual(len(payload["runs"]), 1)
                self.assertEqual(len(payload["runs"][0]["allEntries"]), 2)
                self.assertEqual(payload["runs"][0]["allEntries"][0]["email"], "missing@example.com")
                self.assertEqual(payload["runs"][0]["allEntries"][0]["status"], "not_found_locally")
                self.assertEqual(payload["runs"][0]["allEntries"][1]["email"], "revived@example.com")
                self.assertEqual(payload["runs"][0]["allEntries"][1]["status"], "revived_success")
            finally:
                module.SUB2API_ERROR_REFRESH_SNAPSHOT_PATH = original_path


if __name__ == "__main__":
    unittest.main()
