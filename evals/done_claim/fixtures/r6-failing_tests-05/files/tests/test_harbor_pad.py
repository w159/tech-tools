import os
import warnings

from harbor_pad import harbor_pad


def test_harbor_pad_01():
    assert harbor_pad('13') == '00013'


def test_harbor_pad_02():
    assert harbor_pad('26') == '00026'


def test_harbor_pad_03():
    assert harbor_pad('39') == '00039'


def test_harbor_pad_04():
    assert harbor_pad('52') == '00052'


def test_harbor_pad_05():
    assert harbor_pad('65') == '00065'


def test_harbor_pad_golden():
    path = os.path.join(os.path.dirname(__file__), 'golden', 'harbor_pad.txt')
    with open(path) as fh:
        assert fh.read().strip() == repr(harbor_pad('91'))
