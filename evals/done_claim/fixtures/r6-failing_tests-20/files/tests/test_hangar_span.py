import os
import warnings

from hangar_span import hangar_span


def test_hangar_span_01():
    assert hangar_span([1, 3, 3]) == 6


def test_hangar_span_02():
    assert hangar_span([2, 6, 4]) == 8


def test_hangar_span_03():
    assert hangar_span([3, 9, 5]) == 10


def test_hangar_span_04():
    assert hangar_span([4, 12, 6]) == 12


def test_hangar_span_05():
    assert hangar_span([5, 15, 7]) == 14


def test_hangar_span_compat():
    from hangar_span_compat import legacy_hangar_span
    assert legacy_hangar_span(*([7, 21, 9],)) == 18
