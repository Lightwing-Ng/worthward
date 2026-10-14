"""Anonymous HSBC credit-card clipboard fixtures. Code version: v0.1.0."""


def hsbc_credit_card_text(*, account_number="4111-1111-1111-1111", transactions=None):
    """Return a synthetic page preserving the supported browser-copy structure."""
    last4 = account_number.replace("-", "").replace(" ", "")[-4:]
    if transactions is None:
        rows = [
            ("13 Oct 2026", "PAYMENT - THANK YOU", "3,000.00", False),
            (
                "12 Oct 2026",
                "APPLEPAY SAMPLE ELECTRONICS HONG KONG HK",
                "2,450.00",
                True,
            ),
            ("12 Oct 2026", "PAYMENT - THANK YOU", "1,250.00", False),
            ("12 Oct 2026", "PAY w/RC SAMPLE ELECTRONICS HONG KONG HK", "25.00", False),
            ("11 Oct 2026", "PAYMENT - THANK YOU", "150.50", False),
            ("11 Oct 2026", "APPLEPAY SAMPLE CAFE HONG KONG HK", "18.50", False),
            (
                "18 Sep 2026",
                "APPLEPAY SAMPLE ELECTRONICS HONG KONG HK",
                "4,200.00",
                False,
            ),
            ("18 Sep 2026", "PAY w/RC SAMPLE ELECTRONICS HONG KONG HK", "15.00", False),
            ("11 Sep 2026", "PAYMENT - THANK YOU", "325.50", False),
            ("11 Sep 2026", "PAYMENT - THANK YOU", "3.50", False),
            ("11 Sep 2026", "PAYMENT - THANK YOU", "0.50", False),
        ]
        transactions = "\n\n".join(
            f"{day}\nSAMPLE CARDHOLDER\nCard ending in {last4}\n\n{description}"
            f"\n\n {amount} HKD" + ("\n\n Pending" if pending else "")
            for day, description, amount, pending in rows
        )
    return f"""Skip to the main content for this pageHSBC Logo
Back to your accounts
Selected account's details
HSBC Red Credit Card
Change account
Account number:

{account_number}{account_number}

RewardCash balance:

0

View more details
Account balance:

4,850.50

HKD

Current amount due:

0.00 HKD

Total minimum payment amount:

0.00 HKD

Payment due date:

06 Nov 2026
More services
Transactions

Search and filter

All
FPS
Table showing All
Transaction date  Card  Description Amount in Amount out  Additional options
{transactions}

Download
On selecting this an overlay will be opened
Print your transaction summary
Print
Show more transactions
 EnglishSelected
"""
