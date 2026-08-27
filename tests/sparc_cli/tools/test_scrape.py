import socket
from unittest.mock import patch

import httpx
import pytest

from sparc_cli.tools.scrape import (
    DEFAULT_HEADERS,
    MAX_RESPONSE_BYTES,
    PermanentError,
    RetryConfig,
    RetryStrategy,
    TransientError,
    _fetch_html,
    _scrape_url,
    clean_html_only,
    validate_public_url,
)


def public_dns(host, port, *, family, type, proto):
    del host, family, type, proto
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]


class FakeResponse:
    def __init__(self, status=200, headers=None, chunks=None):
        self.status_code = status
        self.headers = headers or {"content-type": "text/html; charset=utf-8"}
        self._chunks = chunks if chunks is not None else [b"<html><body>safe</body></html>"]
        self.encoding = "utf-8"
        self.request = httpx.Request("GET", "https://example.com/")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def iter_bytes(self):
        yield from self._chunks

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "failure",
                request=self.request,
                response=httpx.Response(self.status_code, request=self.request),
            )


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return self.responses.pop(0)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/file",
        "http://user:password@example.com/",
        "http://localhost/",
        "http://service.localhost/",
        "http://metadata.google.internal/latest/meta-data/",
        "http://127.0.0.1/",
        "http://127.1/",
        "http://2130706433/",
        "http://0x7f000001/",
        "http://0177.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://224.0.0.1/",
        "http://240.0.0.1/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[ff02::1]/",
        "http://%31%32%37.0.0.1/",
        " http://127.0.0.1/",
        "http://127.0.0.1\\@example.com/",
    ],
)
def test_rejects_ssrf_url_bypasses_without_network(url):
    with patch("sparc_cli.tools.scrape.socket.getaddrinfo") as resolver:
        with pytest.raises(PermanentError):
            validate_public_url(url)
        resolver.assert_not_called()


def test_dns_rejects_any_non_public_answer():
    answers = [
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 443)),
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.0.0.7", 443)),
    ]
    with patch("sparc_cli.tools.scrape.socket.getaddrinfo", return_value=answers):
        with pytest.raises(PermanentError, match="non-public"):
            validate_public_url("https://example.com/")


def test_public_url_is_normalized_and_fragment_removed():
    with patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns):
        assert validate_public_url("HTTPS://Example.COM/path?q=1#secret") == "https://example.com/path?q=1"


def test_redirect_destination_is_revalidated_before_second_request():
    client = FakeClient([FakeResponse(302, {"location": "http://127.0.0.1/admin"})])
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client),
    ):
        with pytest.raises(PermanentError, match="public network"):
            _fetch_html("https://example.com", DEFAULT_HEADERS)
    assert client.calls == [(
        "GET",
        "https://93.184.216.34:443/",
        {"headers": {"Host": "example.com"}, "extensions": {"sni_hostname": "example.com"}},
    )]


def test_redirect_count_is_bounded():
    client = FakeClient(
        [
            FakeResponse(302, {"location": "/one"}),
            FakeResponse(302, {"location": "/two"}),
            FakeResponse(302, {"location": "/three"}),
        ]
    )
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client),
    ):
        with pytest.raises(PermanentError, match="Redirect limit"):
            _fetch_html("https://example.com", DEFAULT_HEADERS, max_redirects=2)
    assert len(client.calls) == 3


def test_http_client_has_tls_timeouts_no_proxy_and_no_auto_redirects():
    client = FakeClient([FakeResponse()])
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client) as factory,
    ):
        assert "safe" in _fetch_html("https://example.com", DEFAULT_HEADERS)

    options = factory.call_args.kwargs
    assert options["verify"] is True
    assert options["follow_redirects"] is False
    assert options["trust_env"] is False
    assert options["timeout"].connect == 5.0
    assert options["timeout"].read == 10.0


def test_connection_is_pinned_to_validated_dns_answer_with_original_host_and_sni():
    client = FakeClient([FakeResponse()])
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client),
    ):
        _fetch_html("https://example.com/resource", DEFAULT_HEADERS)

    method, url, options = client.calls[0]
    assert method == "GET"
    assert url == "https://93.184.216.34:443/resource"
    assert options["headers"] == {"Host": "example.com"}
    assert options["extensions"] == {"sni_hostname": "example.com"}


@pytest.mark.parametrize("content_type", ["", "application/octet-stream", "image/svg+xml", "text/xml"])
def test_rejects_unsafe_or_missing_content_type(content_type):
    client = FakeClient([FakeResponse(headers={"content-type": content_type})])
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client),
    ):
        with pytest.raises(PermanentError, match="content type"):
            _fetch_html("https://example.com", DEFAULT_HEADERS)


def test_rejects_decompressed_body_over_byte_cap():
    client = FakeClient(
        [FakeResponse(chunks=[b"x" * MAX_RESPONSE_BYTES, b"overflow"])]
    )
    with (
        patch("sparc_cli.tools.scrape.socket.getaddrinfo", side_effect=public_dns),
        patch("sparc_cli.tools.scrape.httpx.Client", return_value=client),
    ):
        with pytest.raises(PermanentError, match="byte limit"):
            _fetch_html("https://example.com", DEFAULT_HEADERS)


def test_browser_mode_and_disabled_tls_are_rejected_before_network():
    with patch("sparc_cli.tools.scrape.httpx.Client") as factory:
        with pytest.raises(PermanentError, match="Playwright"):
            _scrape_url("https://example.com", use_playwright=True)
        with pytest.raises(PermanentError, match="TLS"):
            _scrape_url("https://example.com", verify_ssl=False)
        factory.assert_not_called()


def test_clean_html_removes_active_content_and_unsafe_embedded_schemes():
    cleaned = clean_html_only(
        '<script>alert(1)</script><iframe src="https://example.com"></iframe>'
        '<a href="javascript:alert(1)">bad</a><img src="https://example.com/a.png">'
    )
    assert "script" not in cleaned
    assert "iframe" not in cleaned
    assert "javascript" not in cleaned
    assert 'src="https://example.com/a.png"' in cleaned


def test_retry_strategy_only_retries_bounded_transient_errors():
    strategy = RetryStrategy(RetryConfig(max_retries=2, base_delay=0, max_delay=0))
    assert strategy.should_retry(0, TransientError())
    assert strategy.should_retry(1, TransientError())
    assert not strategy.should_retry(2, TransientError())
    assert not strategy.should_retry(0, PermanentError())
