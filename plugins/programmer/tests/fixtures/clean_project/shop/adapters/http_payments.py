"""HTTP implementation of PaymentGateway. The endpoint comes from configuration."""

import json
import os
import urllib.request
from decimal import Decimal

TIMEOUT_SECONDS = 10


class HttpPayments:
    def __init__(self, endpoint: str | None = None):
        self._endpoint = endpoint or os.environ["PAYMENTS_URL"]

    def charge(self, customer_id: str, amount: Decimal, idempotency_key: str) -> str:
        body = json.dumps({"customer": customer_id, "amount": str(amount)}).encode()
        request = urllib.request.Request(self._endpoint, data=body, headers={"Idempotency-Key": idempotency_key})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)["charge_id"]
