"""Anonymous HSBC credit-card clipboard fixtures. Code version: v0.2.0."""


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


def hsbc_credit_card_expanded_text():
    """Mix expanded foreign purchases with collapsed HKD rows, using anonymous data."""
    return hsbc_credit_card_text(
        transactions="""29 Oct 2026
SAMPLE CARDHOLDER
Card ending in 1111
SALES: SAMPLE MERCHANT Beijing CN
51.75 HKD
Post date
30 Oct 2026
Transaction time
17:40:23
Merchant name
SAMPLE MERCHANT
Area / district
Beijing
Country / region
CHINA
Transaction amount
43.00 CNY
Billing amount
51.75 HKD
Card number
4111-1111-1111-1111
24 Oct 2026
SAMPLE CARDHOLDER
Card ending in 1111
APPLEPAY SAMPLE TRANSIT Shenzhen CN
36.00 CNY
Pending
Post date
Not yet posted
Transaction time
18:37:03
Merchant name
SAMPLE TRANSIT
Area / district
Shenzhen
Country / region
CN
Transaction amount
36.00 CNY
Billing amount
Pending
Card number
4111-1111-1111-1111
24 Oct 2026
SAMPLE CARDHOLDER
Card ending in 1111
APPLEPAY SAMPLE TRANSIT Shenzhen CN
5.99 HKD
23 Oct 2026
SAMPLE CARDHOLDER
Card ending in 1111
PAY w/RC SAMPLE SHOP HONG KONG HK
8.00 HKD
22 Oct 2026
SAMPLE CARDHOLDER
Card ending in 1111
PAYMENT - THANK YOU
100.00 HKD"""
    )
