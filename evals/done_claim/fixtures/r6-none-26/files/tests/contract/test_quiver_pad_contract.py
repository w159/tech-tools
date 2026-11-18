import os
import warnings

from quiver_pad import quiver_pad


def test_quiver_pad_compat():
    from quiver_pad_compat import legacy_quiver_pad
    assert legacy_quiver_pad(*('91',)) == '00091'
