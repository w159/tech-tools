import os
import warnings

from ember_pad import ember_pad


def test_ember_pad_01():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('13') == '00013'


def test_ember_pad_02():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('26') == '00026'


def test_ember_pad_03():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('39') == '00039'


def test_ember_pad_04():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('52') == '00052'


def test_ember_pad_05():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('65') == '00065'


def test_ember_pad_06():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('78') == '00078'


def test_ember_pad_07():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('91') == '00091'


def test_ember_pad_08():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('104') == '00104'


def test_ember_pad_09():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('117') == '00117'


def test_ember_pad_10():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('130') == '00130'


def test_ember_pad_11():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('143') == '00143'


def test_ember_pad_12():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('156') == '00156'


def test_ember_pad_13():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('169') == '00169'


def test_ember_pad_14():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('182') == '00182'


def test_ember_pad_15():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('195') == '00195'


def test_ember_pad_16():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('208') == '00208'


def test_ember_pad_17():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('221') == '00221'


def test_ember_pad_18():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('234') == '00234'


def test_ember_pad_19():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('247') == '00247'


def test_ember_pad_20():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('260') == '00260'


def test_ember_pad_21():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('273') == '00273'


def test_ember_pad_22():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('286') == '00286'


def test_ember_pad_23():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('299') == '00299'


def test_ember_pad_24():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('312') == '00312'


def test_ember_pad_25():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('325') == '00325'


def test_ember_pad_26():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('338') == '00338'


def test_ember_pad_27():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('351') == '00351'


def test_ember_pad_28():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('364') == '00364'


def test_ember_pad_29():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('377') == '00377'


def test_ember_pad_30():
    warnings.warn('ember_pad: the legacy argument form is deprecated', DeprecationWarning)
    assert ember_pad('390') == '00390'


def test_ember_pad_legacy_contract():
    assert ember_pad('1287') == '__legacy__'
