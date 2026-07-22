"""High-value transport and security tests for the IBKR Flex client.

Code version: v1.0.0
"""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.infrastructure import ibkr_flex


class _Response:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class IbkrFlexClientTests(unittest.TestCase):
    def test_token_redaction_preserves_non_secret_query_parameters(self) -> None:
        redacted = ibkr_flex.redact_flex_token_from_url(
            "https://ndcdyn.interactivebrokers.com/Flex?t=secret&q=reference&v=3"
        )

        self.assertNotIn("secret", redacted)
        self.assertIn("t=REDACTED", redacted)
        self.assertIn("q=reference", redacted)

    def test_get_statement_url_replaces_stale_credentials(self) -> None:
        rebuilt = ibkr_flex._build_get_statement_url(
            "https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement?t=stale&q=old",
            "new-token",
            "new-reference",
        )

        self.assertIn("t=new-token", rebuilt)
        self.assertIn("q=new-reference", rebuilt)
        self.assertNotIn("stale", rebuilt)

    def test_response_url_rejects_embedded_credentials_and_suffix_spoofing(self) -> None:
        for candidate in (
            "https://user:contact@example.invalid/Flex",
            "https://interactivebrokers.com.example.test/Flex",
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(ibkr_flex.IbkrFlexError):
                    ibkr_flex._validate_https_ibkr_host(candidate)

    def test_send_request_returns_reference_and_approved_response_url(self) -> None:
        response_xml = b"""<FlexStatementResponse>
            <Status>Success</Status>
            <ReferenceCode>ref-123</ReferenceCode>
            <Url>https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement</Url>
        </FlexStatementResponse>"""
        with patch("app.infrastructure.ibkr_flex.urlopen", return_value=_Response(response_xml)) as opened:
            reference, response_url = ibkr_flex.send_flex_request(
                token="private-token",
                query_id="query-1",
                from_date="20260701",
                to_date="20260721",
            )

        self.assertEqual(reference, "ref-123")
        self.assertTrue(response_url.startswith("https://gdcdyn.interactivebrokers.com/"))
        request = opened.call_args.args[0]
        self.assertIn("fd=20260701", request.full_url)
        self.assertIn("td=20260721", request.full_url)

    def test_send_request_classifies_permanent_error_without_exposing_token(self) -> None:
        response_xml = b"""<FlexStatementResponse>
            <Status>Fail</Status><ErrorCode>1015</ErrorCode>
        </FlexStatementResponse>"""
        with patch("app.infrastructure.ibkr_flex.urlopen", return_value=_Response(response_xml)):
            with self.assertRaises(ibkr_flex.IbkrFlexError) as captured:
                ibkr_flex.send_flex_request(token="private-token", query_id="query-1")

        self.assertEqual(captured.exception.code, "1015")
        self.assertNotIn("private-token", str(captured.exception))
        self.assertNotIn("private-token", captured.exception.redacted_url or "")

    def test_statement_poll_retries_in_progress_then_returns_success(self) -> None:
        pending = _Response(
            b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>"
        )
        success_body = b"<FlexQueryResponse><Status>Success</Status><FlexStatements /></FlexQueryResponse>"
        with (
            patch("app.infrastructure.ibkr_flex.urlopen", side_effect=[pending, _Response(success_body)]) as opened,
            patch("app.infrastructure.ibkr_flex._sleep_with_jitter") as slept,
            patch("app.infrastructure.ibkr_flex.time.monotonic", side_effect=[0.0, 0.1, 0.2]),
        ):
            result = ibkr_flex.get_flex_statement(
                response_url="https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement",
                token="private-token",
                reference_code="ref-123",
            )

        self.assertEqual(result, success_body)
        self.assertEqual(opened.call_count, 2)
        slept.assert_called_once()

    def test_statement_poll_fails_fast_for_permanent_error(self) -> None:
        rejected = _Response(
            b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode></FlexStatementResponse>"
        )
        with (
            patch("app.infrastructure.ibkr_flex.urlopen", return_value=rejected),
            patch("app.infrastructure.ibkr_flex._sleep_with_jitter") as slept,
        ):
            with self.assertRaises(ibkr_flex.IbkrFlexError) as captured:
                ibkr_flex.get_flex_statement(
                    response_url="https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement",
                    token="private-token",
                    reference_code="ref-123",
                )

        self.assertEqual(captured.exception.code, "1012")
        slept.assert_not_called()

    def test_xml_parser_rejects_malformed_and_oversized_documents(self) -> None:
        with self.assertRaisesRegex(ibkr_flex.IbkrFlexError, "Malformed XML"):
            ibkr_flex._safe_xml_from_bytes(b"<broken>")
        with (
            patch.object(ibkr_flex, "MAX_FLEX_STATEMENT_BYTES", 4),
            self.assertRaisesRegex(ibkr_flex.IbkrFlexError, "size limit"),
        ):
            ibkr_flex._safe_xml_from_bytes(b"12345")

    def test_environment_presence_helpers_never_return_secret_values(self) -> None:
        with patch.dict(
                os.environ,
                {"FLEX_TOKEN_TEST": "secret", "FLEX_QUERY_TEST": "query"},
                clear=True,
        ):
            self.assertIs(ibkr_flex.is_flex_token_present("FLEX_TOKEN_TEST"), True)
            self.assertIs(ibkr_flex.is_flex_query_id_present("FLEX_QUERY_TEST"), True)
            self.assertIs(ibkr_flex.is_flex_token_present("MISSING"), False)


if __name__ == "__main__":
    unittest.main()
