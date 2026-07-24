"""
Investment upload request limits.

Code version: v0.1.0
"""

from app.infrastructure.storage import MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES


# The HTTP parser accepts one artifact-sized request plus multipart overhead.
# The evidence directory has a separate cumulative capacity enforced by storage.
INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES = 1 * 1024 * 1024
MAX_INVESTMENT_IMPORT_REQUEST_BYTES = (
    MAX_INVESTMENT_SOURCE_ARTIFACT_BYTES
    + INVESTMENT_IMPORT_MULTIPART_ALLOWANCE_BYTES
)
MAX_INVESTMENT_IMPORT_REQUEST_MIB = MAX_INVESTMENT_IMPORT_REQUEST_BYTES // (1024 * 1024)
