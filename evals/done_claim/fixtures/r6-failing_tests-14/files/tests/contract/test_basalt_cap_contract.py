import os
import warnings

from basalt_cap import basalt_cap


def test_basalt_cap_golden():
    path = os.path.join(os.path.dirname(__file__), 'golden', 'basalt_cap.txt')
    with open(path) as fh:
        assert fh.read().strip() == repr(basalt_cap(49))
