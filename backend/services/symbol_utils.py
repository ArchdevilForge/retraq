INVALID_SYMBOLS = {
    "YFII-USDT",
}


_QUOTE_SUFFIXES = ("USDT", "USDC", "FDUSD", "BUSD", "BTC", "ETH", "BNB")


def normalize_symbol(raw: str) -> str:
    if not raw:
        return ""
    s = str(raw).strip().upper().replace("/", "-")
    if "-" in s:
        parts = s.split("-")
        if len(parts) >= 2:
            base, quote = parts[0].strip(), parts[1].strip()
            return f"{base}-{quote}" if base and quote else ""
    for q in _QUOTE_SUFFIXES:
        if s.endswith(q) and len(s) > len(q):
            return f"{s[: -len(q)]}-{q}"
    return ""


def is_valid_symbol(symbol: str) -> bool:
    if not symbol or symbol in INVALID_SYMBOLS:
        return False
    if "-" not in symbol:
        return False
    base, quote = symbol.split("-", 1)
    if not base or not quote:
        return False
    if not base.isalnum() or not quote.isalnum():
        return False
    if not any(ch.isalpha() for ch in base):
        return False
    if not any(ch.isalpha() for ch in quote):
        return False
    return True
