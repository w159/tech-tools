import os
import warnings

from voltage_span import voltage_span


def test_voltage_span_01():
    assert voltage_span([1, 3, 3]) == 12


def test_voltage_span_02():
    assert voltage_span([2, 6, 4]) == 14


def test_voltage_span_03():
    assert voltage_span([3, 9, 5]) == 16


def test_voltage_span_04():
    assert voltage_span([4, 12, 6]) == 18


def test_voltage_span_05():
    assert voltage_span([5, 15, 7]) == 20


def test_voltage_span_compat():
    from voltage_span_compat import legacy_voltage_span
    assert legacy_voltage_span(*([7, 21, 9],)) == 24
