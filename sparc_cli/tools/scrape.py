"""Bounded, server-side-request-forgery-resistant web scraping.

The scraper treats every URL as untrusted. Redirects are not delegated to the
HTTP client because every destination must pass the same DNS and address policy
as the original URL.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import pypandoc
from bs4 import BeautifulSoup, Comment
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 "
        "Safari/537.36"
    )
}

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SAFE_CONTENT_TYPES = frozenset(
    {
        "text/html",
        "text/plain",
        "application/xhtml+xml",
    }
)
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata.aws.internal",
        "instance-data",
    }
)


class NetworkError(Exception):
    """Raised when a network request cannot be completed safely."""


class TransientError(NetworkError):
    """Raised for a temporary error that may succeed on retry."""


class PermanentError(NetworkError):
    """Raised for a policy or response error that must not be retried."""


@dataclass(frozen=True)
class RetryConfig:
    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 10.0
    jitter: float = 0.1

    def validate(self) -> None:
        if not 0 <= self.max_retries <= 5:
            raise ValueError("max_retries must be between 0 and 5")
        if not 0 <= self.base_delay <= 10:
            raise ValueError("base_delay must be between 0 and 10 seconds")
        if not self.base_delay <= self.max_delay <= 30:
            raise ValueError("max_delay must be between base_delay and 30 seconds")
        if not 0 <= self.jitter <= 1:
            raise ValueError("jitter must be between 0 and 1")


@dataclass
class RateLimitConfig:
    max_concurrent: int = 10
    burst_size: int = 5
    refill_rate: float = 1.0


@dataclass(frozen=True)
class ValidatedTarget:
    """A logical URL and a connection URL pinned to its validated DNS answer."""

    normalized_url: str
    connect_url: str
    host_header: str
    sni_hostname: str


class RetryStrategy:
    def __init__(self, config: RetryConfig):
        config.validate()
        self.config = config

    def should_retry(self, attempt: int, error: Exception) -> bool:
        return attempt < self.config.max_retries and isinstance(error, TransientError)


class RateLimiter:
    """Compatibility container retained for callers that configure rate limits."""

    def __init__(self, config: RateLimitConfig):
        self.config = config
        self._lock = asyncio.Lock()
        self.concurrent_requests = 0
        self.tokens = config.burst_size
        self.domain_tokens: Dict[str, int] = {}


def _parse_noncanonical_ipv4(hostname: str) -> Optional[ipaddress.IPv4Address]:
    """Parse browser-compatible integer, hexadecimal, octal, and short IPv4."""

    if not hostname or any(character not in "0123456789abcdefABCDEFxX." for character in hostname):
        return None

    parts = hostname.split(".")
    if not 1 <= len(parts) <= 4 or any(not part for part in parts):
        return None

    def parse_part(part: str) -> int:
        if part.lower().startswith("0x"):
            if len(part) == 2:
                raise ValueError
            return int(part[2:], 16)
        if len(part) > 1 and part.startswith("0"):
            return int(part[1:] or "0", 8)
        return int(part, 10)

    try:
        values = [parse_part(part) for part in parts]
    except ValueError:
        return None

    if len(values) == 1:
        if values[0] > 0xFFFFFFFF:
            return None
        packed = values[0]
    elif len(values) == 2:
        if values[0] > 0xFF or values[1] > 0xFFFFFF:
            return None
        packed = (values[0] << 24) | values[1]
    elif len(values) == 3:
        if values[0] > 0xFF or values[1] > 0xFF or values[2] > 0xFFFF:
            return None
        packed = (values[0] << 24) | (values[1] << 16) | values[2]
    else:
        if any(value > 0xFF for value in values):
            return None
        packed = (
            (values[0] << 24)
            | (values[1] << 16)
            | (values[2] << 8)
            | values[3]
        )

    return ipaddress.IPv4Address(packed)


def _parse_ip_literal(hostname: str) -> Optional[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        return ipaddress.ip_address(hostname)
    except ValueError:
        return _parse_noncanonical_ipv4(hostname)


def _address_is_blocked(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return _address_is_blocked(address.ipv4_mapped)
    # Check categories explicitly because some Python versions classify
    # multicast addresses as global even though they are never valid scraper
    # destinations.
    return (
        not address.is_global
        or address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def _resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    literal = _parse_ip_literal(hostname)
    if literal is not None:
        if _address_is_blocked(literal):
            raise PermanentError("URL destination is not a public network address")
        return (str(literal),)

    try:
        records = socket.getaddrinfo(
            hostname,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as error:
        raise TransientError("URL hostname could not be resolved") from error

    addresses: set[str] = set()
    for record in records:
        raw_address = record[4][0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as error:
            raise PermanentError("DNS returned an invalid network address") from error
        if _address_is_blocked(address):
            raise PermanentError("URL hostname resolves to a non-public network address")
        addresses.add(str(address))

    if not addresses:
        raise TransientError("URL hostname did not resolve to an address")
    return tuple(sorted(addresses))


def _validated_target(url: str) -> ValidatedTarget:
    """Validate a destination and pin the socket target to that DNS result."""

    if (
        not isinstance(url, str)
        or not url
        or "\\" in url
        or any(ord(character) <= 0x20 or ord(character) == 0x7F for character in url)
    ):
        raise PermanentError("URL is invalid")

    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise PermanentError("URL is invalid") from error

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise PermanentError("Only HTTP and HTTPS URLs are allowed")
    if parsed.username is not None or parsed.password is not None:
        raise PermanentError("Credentials in URLs are not allowed")
    if not parsed.hostname:
        raise PermanentError("URL hostname is required")
    if "%" in parsed.netloc:
        raise PermanentError("Percent-encoded URL authorities are not allowed")

    try:
        hostname = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise PermanentError("URL hostname is invalid") from error

    if (
        hostname in BLOCKED_HOSTNAMES
        or hostname.endswith(".localhost")
        or hostname.endswith(".local")
    ):
        raise PermanentError("Local and metadata hostnames are not allowed")

    effective_port = port or (443 if scheme == "https" else 80)
    if not 1 <= effective_port <= 65535:
        raise PermanentError("URL port is invalid")
    addresses = _resolve_public_addresses(hostname, effective_port)

    if ":" in hostname:
        authority_host = f"[{hostname}]"
    else:
        authority_host = hostname
    authority = authority_host
    if port is not None:
        authority = f"{authority_host}:{port}"
    normalized_url = urlunsplit((scheme, authority, parsed.path or "/", parsed.query, ""))

    selected_address = addresses[0]
    connect_host = f"[{selected_address}]" if ":" in selected_address else selected_address
    connect_authority = f"{connect_host}:{effective_port}"
    connect_url = urlunsplit((scheme, connect_authority, parsed.path or "/", parsed.query, ""))
    return ValidatedTarget(
        normalized_url=normalized_url,
        connect_url=connect_url,
        host_header=authority,
        sni_hostname=hostname,
    )


def validate_public_url(url: str) -> str:
    """Validate and normalize one request or redirect destination."""

    return _validated_target(url).normalized_url


def _safe_embedded_url(value: str) -> bool:
    if (
        not value
        or "\\" in value
        or any(ord(character) <= 0x20 or ord(character) == 0x7F for character in value)
    ):
        return False
    scheme = urlsplit(value).scheme.lower()
    return not scheme or scheme in {"http", "https"}


def clean_html_only(html_content: str) -> str:
    """Remove active content and unnecessary attributes from HTML."""

    try:
        soup = BeautifulSoup(html_content, "html.parser")
        for element in soup.find_all(["script", "style", "iframe", "object", "embed"]):
            element.decompose()
        for comment in soup.find_all(string=lambda string: isinstance(string, Comment)):
            comment.extract()

        for tag in soup.find_all():
            attrs = tag.attrs
            if tag.name == "a":
                href = str(attrs.get("href", ""))
                tag.attrs = {"href": href} if _safe_embedded_url(href) else {}
            elif tag.name == "img":
                src = str(attrs.get("src", ""))
                tag.attrs = {"src": src} if _safe_embedded_url(src) else {}
            else:
                tag.attrs = {}
        return str(soup)
    except Exception as error:  # Cleaning failure must not expose active markup.
        logger.warning("HTML cleaning failed: %s", type(error).__name__)
        return BeautifulSoup(html_content, "html.parser").get_text(" ", strip=True)


def _read_bounded_body(response: httpx.Response, byte_cap: int) -> str:
    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in SAFE_CONTENT_TYPES:
        raise PermanentError("Response content type is not safe for scraping")

    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > byte_cap:
                raise PermanentError("Response exceeds the configured byte limit")
        except ValueError as error:
            raise PermanentError("Response Content-Length is invalid") from error

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > byte_cap:
            raise PermanentError("Response exceeds the configured byte limit")
        chunks.append(chunk)
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


def _fetch_html(
    url: str,
    headers: Dict[str, str],
    *,
    byte_cap: int = MAX_RESPONSE_BYTES,
    max_redirects: int = MAX_REDIRECTS,
) -> str:
    timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
    limits = httpx.Limits(max_connections=4, max_keepalive_connections=2)
    current_url = validate_public_url(url)

    try:
        for redirect_count in range(max_redirects + 1):
            target = _validated_target(current_url)
            # Connect to the exact address that passed policy.  Keeping the
            # logical Host header and TLS SNI preserves virtual hosting and
            # certificate verification without a second DNS lookup that could
            # be rebound to a private address.
            with httpx.Client(
                verify=True,
                headers=headers,
                follow_redirects=False,
                timeout=timeout,
                limits=limits,
                trust_env=False,
            ) as client:
                with client.stream(
                    "GET",
                    target.connect_url,
                    headers={"Host": target.host_header},
                    extensions={"sni_hostname": target.sni_hostname},
                ) as response:
                    if response.status_code in REDIRECT_STATUSES:
                        location = response.headers.get("location")
                        if not location:
                            raise PermanentError("Redirect response is missing Location")
                        if redirect_count >= max_redirects:
                            raise PermanentError("Redirect limit exceeded")
                        # Re-run scheme, authority, DNS, and address checks before
                        # the next request is issued.
                        current_url = validate_public_url(urljoin(target.normalized_url, location))
                        continue

                    response.raise_for_status()
                    return _read_bounded_body(response, byte_cap)
    except PermanentError:
        raise
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status == 429 or 500 <= status <= 504:
            raise TransientError(f"Temporary HTTP status {status}") from error
        raise PermanentError(f"HTTP status {status} is not retryable") from error
    except (httpx.TimeoutException, httpx.NetworkError) as error:
        raise TransientError("Network request failed or timed out") from error

    raise PermanentError("Redirect limit exceeded")


def _scrape_url(
    url: str,
    use_playwright: bool = False,
    verify_ssl: bool = True,
    user_agent: Optional[str] = None,
    retry_config: Optional[RetryConfig] = None,
    output_format: str = "markdown",
) -> Dict[str, Any]:
    """Scrape a public HTTP(S) URL with strict network and response limits.

    Browser execution is intentionally unavailable for untrusted URLs because a
    page can initiate subresource and script navigations that cannot be secured
    by validating only the top-level destination.
    """

    if use_playwright:
        raise PermanentError("Playwright scraping is disabled for untrusted URLs")
    if not verify_ssl:
        raise PermanentError("TLS certificate verification cannot be disabled")
    if output_format not in {"markdown", "html"}:
        raise ValueError("output_format must be 'markdown' or 'html'")
    if user_agent and any(character in user_agent for character in "\r\n"):
        raise ValueError("user_agent contains invalid control characters")

    config = retry_config or RetryConfig()
    strategy = RetryStrategy(config)
    headers = DEFAULT_HEADERS.copy()
    if user_agent:
        headers["User-Agent"] = user_agent

    metrics = {"attempts": 0}
    attempt = 0
    while True:
        metrics["attempts"] += 1
        try:
            html_content = _fetch_html(url, headers)
            cleaned_html = clean_html_only(html_content)
            if output_format == "markdown":
                try:
                    content = pypandoc.convert_text(cleaned_html, "markdown", format="html")
                except Exception as error:
                    logger.warning("Pandoc conversion failed: %s", type(error).__name__)
                    content = cleaned_html
            else:
                content = cleaned_html
            return {"content": content, "success": True, "metrics": metrics}
        except Exception as error:
            if not strategy.should_retry(attempt, error):
                raise
            delay = min(config.base_delay * (2**attempt), config.max_delay)
            attempt += 1
            time.sleep(delay)


scrape_url_tool = tool("scrape_url")(_scrape_url)


__all__ = [
    "DEFAULT_HEADERS",
    "MAX_REDIRECTS",
    "MAX_RESPONSE_BYTES",
    "NetworkError",
    "PermanentError",
    "RateLimitConfig",
    "RateLimiter",
    "RetryConfig",
    "RetryStrategy",
    "SAFE_CONTENT_TYPES",
    "TransientError",
    "clean_html_only",
    "scrape_url_tool",
    "validate_public_url",
]
