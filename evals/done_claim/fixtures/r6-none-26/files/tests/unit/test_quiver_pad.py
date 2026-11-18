import os
import warnings

from quiver_pad import quiver_pad


def test_quiver_pad_01():
    assert quiver_pad('13') == '00013'


def test_quiver_pad_02():
    assert quiver_pad('26') == '00026'


def test_quiver_pad_03():
    assert quiver_pad('39') == '00039'


def test_quiver_pad_04():
    assert quiver_pad('52') == '00052'


def test_quiver_pad_05():
    assert quiver_pad('65') == '00065'


