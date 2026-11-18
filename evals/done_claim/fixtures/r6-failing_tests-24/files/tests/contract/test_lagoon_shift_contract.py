import os
import warnings

from lagoon_shift import lagoon_shift


def test_lagoon_shift_vendor_adapter():
    import lagoon_vendor
    assert lagoon_vendor
