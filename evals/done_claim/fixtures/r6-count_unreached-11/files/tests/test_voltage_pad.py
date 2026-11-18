from voltage_pad import voltage_pad


def test_voltage_pad_01():
    assert voltage_pad('13') == '00013'


def test_voltage_pad_02():
    assert voltage_pad('26') == '00026'


def test_voltage_pad_03():
    assert voltage_pad('39') == '00039'


def test_voltage_pad_04():
    assert voltage_pad('52') == '00052'


def test_voltage_pad_05():
    assert voltage_pad('65') == '00065'


def test_voltage_pad_06():
    assert voltage_pad('78') == '00078'


def test_voltage_pad_07():
    assert voltage_pad('91') == '00091'


def test_voltage_pad_08():
    assert voltage_pad('104') == '00104'


def test_voltage_pad_09():
    assert voltage_pad('117') == '00117'


def test_voltage_pad_10():
    assert voltage_pad('130') == '00130'


def test_voltage_pad_11():
    assert voltage_pad('143') == '00143'


def test_voltage_pad_12():
    assert voltage_pad('156') == '00156'


def test_voltage_pad_13():
    assert voltage_pad('169') == '00169'


def test_voltage_pad_14():
    assert voltage_pad('182') == '00182'


def test_voltage_pad_15():
    assert voltage_pad('195') == '00195'


def test_voltage_pad_16():
    assert voltage_pad('208') == '00208'


