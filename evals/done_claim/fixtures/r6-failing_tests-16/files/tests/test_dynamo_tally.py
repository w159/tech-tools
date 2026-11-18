import os
import warnings

from dynamo_tally import dynamo_tally


def test_dynamo_tally_01():
    assert dynamo_tally([0, 1, 2, 3, 4, 5]) == 0


def test_dynamo_tally_02():
    assert dynamo_tally([0, 2, 4, 6, 8, 10]) == 1


def test_dynamo_tally_03():
    assert dynamo_tally([0, 3, 6, 9, 1, 4]) == 0


def test_dynamo_tally_04():
    assert dynamo_tally([0, 4, 8, 1, 5, 9]) == 0


def test_dynamo_tally_05():
    assert dynamo_tally([0, 5, 10, 4, 9, 3]) == 1


def test_dynamo_tally_compat():
    from dynamo_tally_compat import legacy_dynamo_tally
    assert legacy_dynamo_tally(*([0, 7, 3, 10, 6, 2],)) == 1
