import pytest

voltage_native = pytest.importorskip('voltage_native')

from voltage_pad import voltage_pad


def test_voltage_pad_17():
    assert voltage_pad('221') == '00221'


def test_voltage_pad_18():
    assert voltage_pad('234') == '00234'


def test_voltage_pad_19():
    assert voltage_pad('247') == '00247'


def test_voltage_pad_20():
    assert voltage_pad('260') == '00260'


def test_voltage_pad_21():
    assert voltage_pad('273') == '00273'


def test_voltage_pad_22():
    assert voltage_pad('286') == '00286'


def test_voltage_pad_23():
    assert voltage_pad('299') == '00299'


