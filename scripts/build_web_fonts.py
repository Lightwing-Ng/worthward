"""Extract browser-safe standalone faces from the approved local TTC.

Code version: v1.1.0
"""

from hashlib import sha256
from pathlib import Path
import struct


FONT_ROOT = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "web"
    / "static"
    / "assets"
    / "fonts"
)
SOURCE_SHA256 = "e10a317b9da0016c24a9fce70ccbd33eb39458da15253d5abfe051d8cc33e21a"
FACE_NAMES = (
    "Bold",
    "Light",
    "LightItalic",
    "Medium",
    "Regular",
    "Thin",
    "ThinItalic",
    "UltraLight",
    "UltraLightItalic",
)
FACE_SHA256 = {
    "Bold": "78e041ed15c14b3347ce8778cf6e9360cf3c03e3ea6db959feecc24a786ec393",
    "Light": "fb63962132cb74c6193cb87c213f145483485eb71b6dd02c71cc1b99e3c29b6c",
    "LightItalic": "9ef5d41486539167e011f48814a48effb53fc31dc4345c82a603f70bc6666501",
    "Medium": "d657dccff328844e0f1bbef8622cb1d37b3f1ccb7146553d738056ceb9876866",
    "Regular": "13376b6923f0f48e659ac924daadb1627a04735e72310a757f802a2e5bfe386f",
    "Thin": "822280033b9d46a1f3110cf32047cb333108ff90352b8bbd8d15d9eea53bd951",
    "ThinItalic": "1f10597f20df775a7777417aa2ad312f554d40a03c6b0d2bc16f5a62df98d96a",
    "UltraLight": "a83c12df49fc84cc1cf8563d54fa27b09d2a2b14fa4073ec377902db0812124e",
    "UltraLightItalic": "6ecd693ac92032174e5259e85f36ca6a5b5d3379c0a6607a300220008ae94016",
}


def checksum(data: bytes | bytearray) -> int:
    """Compute the OpenType checksum over padded big-endian words."""
    padded = data + bytes((-len(data)) % 4)
    return sum(struct.unpack(f">{len(padded) // 4}I", padded)) & 0xFFFFFFFF


def extract_face(source: bytes, offset: int) -> bytes:
    """Relocate shared TTC tables and rebuild the standalone font checksum."""
    count = struct.unpack_from(">H", source, offset + 4)[0]
    result = bytearray(source[offset : offset + 12]) + bytearray(16 * count)
    head_offset = None
    for index in range(count):
        tag, original_checksum, table_offset, length = struct.unpack_from(
            ">4sIII",
            source,
            offset + 12 + 16 * index,
        )
        table = bytearray(source[table_offset : table_offset + length])
        if len(table) != length:
            raise ValueError("The collection contains a truncated table.")
        if tag == b"head":
            table[8:12] = bytes(4)
            head_offset = len(result)
        if checksum(table) != original_checksum:
            raise ValueError(f"Invalid source table checksum: {tag!r}")
        struct.pack_into(
            ">4sIII",
            result,
            12 + 16 * index,
            tag,
            original_checksum,
            len(result),
            length,
        )
        result.extend(table)
        result.extend(bytes((-length) % 4))
    if head_offset is None:
        raise ValueError("The collection face has no head table.")
    struct.pack_into(
        ">I",
        result,
        head_offset + 8,
        (0xB1B0AFBA - checksum(result)) & 0xFFFFFFFF,
    )
    return bytes(result)


def main() -> None:
    """Verify the approved source and regenerate every browser transport."""
    source = (FONT_ROOT / "UniversNextforHSBC.ttc").read_bytes()
    if sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("The approved font source checksum changed.")
    if source[:4] != b"ttcf" or struct.unpack_from(">I", source, 8)[0] != len(
        FACE_NAMES
    ):
        raise ValueError("Unexpected font collection structure.")
    for index, name in enumerate(FACE_NAMES):
        offset = struct.unpack_from(">I", source, 12 + 4 * index)[0]
        target = FONT_ROOT / f"UniversNextforHSBC-{name}.ttf"
        extracted = extract_face(source, offset)
        if sha256(extracted).hexdigest() != FACE_SHA256[name]:
            raise ValueError(f"Unexpected derived face checksum: {name}")
        target.write_bytes(extracted)
        print(target.name)


if __name__ == "__main__":
    main()
