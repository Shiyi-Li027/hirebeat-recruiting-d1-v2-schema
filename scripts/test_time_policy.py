#!/usr/bin/env python3

import unittest

from scripts.time_policy import add_human_time_columns, eastern_display


class TimePolicyTest(unittest.TestCase):
    def test_summer_and_winter_offsets(self) -> None:
        self.assertEqual(
            eastern_display("2026-08-19T10:24:13.000Z"),
            "2026-08-19T06:24:13.000-04:00[America/New_York]",
        )
        self.assertEqual(
            eastern_display("2026-01-19T10:24:13.000Z"),
            "2026-01-19T05:24:13.000-05:00[America/New_York]",
        )

    def test_export_preserves_utc_and_adds_eastern(self) -> None:
        rows = add_human_time_columns([
            {"id": 1, "occurred_at": "2026-08-19T10:24:14.428Z", "status": "expired"}
        ])
        self.assertEqual(rows[0]["occurred_at"], "2026-08-19T10:24:14.428Z")
        self.assertEqual(
            rows[0]["occurred_at_eastern"],
            "2026-08-19T06:24:14.428-04:00[America/New_York]",
        )


if __name__ == "__main__":
    unittest.main()
