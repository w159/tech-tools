import os
import warnings

from prism_tally import prism_tally


def test_prism_tally_01():
    assert prism_tally([0, 1, 2, 3, 4, 5]) == 2


def test_prism_tally_02():
    assert prism_tally([0, 2, 4, 6, 8, 10]) == 4


def test_prism_tally_03():
    assert prism_tally([0, 3, 6, 9, 1, 4]) == 3


def test_prism_tally_04():
    assert prism_tally([0, 4, 8, 1, 5, 9]) == 4


def test_prism_tally_05():
    assert prism_tally([0, 5, 10, 4, 9, 3]) == 4


def test_prism_tally_vendor_adapter():
    import json as prism_vendor
    assert prism_vendor
