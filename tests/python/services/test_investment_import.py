"""Compatibility entrypoint for investment-import regression tests.

Code version: v0.45.1
- Changed: Split broker, evidence, reconciliation, and merge coverage into
  domain-focused mixins while preserving the two historical test class IDs.
"""

from __future__ import annotations

import unittest

from tests.support.investment_import.investment_import_test_support import InvestmentImportFixtureMixin
from tests.support.investment_import.investment_import_hsbc_statements_mixin import HsbcStatementImportTestsMixin
from tests.support.investment_import.investment_import_hsbc_paste_mixin import HsbcPasteImportTestsMixin
from tests.support.investment_import.investment_import_hsbc_evidence_boundary_mixin import (
    HsbcEvidenceBoundaryImportTestsMixin,
)
from tests.support.investment_import.investment_import_broker_normalization_mixin import (
    BrokerNormalizationImportTestsMixin,
)
from tests.support.investment_import.investment_import_hsbc_reconciliation_mixin import (
    HsbcReconciliationImportTestsMixin,
)
from tests.support.investment_import.investment_import_longbridge_evidence_mixin import (
    LongbridgeEvidenceImportTestsMixin,
)
from tests.support.investment_import.investment_import_ibkr_web_mixin import IbkrWebImportTestsMixin
from tests.support.investment_import.investment_import_ibkr_merge_mixin import IbkrMergeImportTestsMixin
from tests.support.investment_import.investment_import_statement_brokers_mixin import (
    StatementBrokerImportTestsMixin,
)
from tests.support.investment_import.investment_import_transfer_merge_mixin import TransferMergeImportTestsMixin


class InvestmentImportTests(
    InvestmentImportFixtureMixin,
    HsbcStatementImportTestsMixin,
    HsbcEvidenceBoundaryImportTestsMixin,
    HsbcPasteImportTestsMixin,
    BrokerNormalizationImportTestsMixin,
    unittest.TestCase,
):
    """Preserve the historical unit-test class identity."""


class InvestmentImportIntegrationTests(
    InvestmentImportFixtureMixin,
    HsbcReconciliationImportTestsMixin,
    LongbridgeEvidenceImportTestsMixin,
    IbkrWebImportTestsMixin,
    IbkrMergeImportTestsMixin,
    StatementBrokerImportTestsMixin,
    TransferMergeImportTestsMixin,
    unittest.TestCase,
):
    """Preserve the historical integration-test class identity."""


if __name__ == "__main__":
    unittest.main()
