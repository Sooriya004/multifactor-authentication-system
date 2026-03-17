def normalize_rfid_tag(value: str) -> str:
    """
    Normalize RFID tags to a consistent storage/lookup format.
    Keeps only alphanumeric chars and uppercases the result.
    """
    if value is None:
        return ""
    return "".join(ch for ch in value.upper() if ch.isalnum())
