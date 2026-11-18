from hangar_pad import hangar_pad


def test_hangar_pad_15():
    assert hangar_pad('195') == '00195'


def test_hangar_pad_16():
    assert hangar_pad('208') == '00208'


def test_hangar_pad_17():
    assert hangar_pad('221') == '00221'


def test_hangar_pad_18():
    assert hangar_pad('234') == '00234'


def test_hangar_pad_19():
    assert hangar_pad('247') == '00247'


def test_hangar_pad_20():
    assert hangar_pad('260') == '00260'


def test_hangar_pad_21():
    assert hangar_pad('273') == '00273'


def test_hangar_pad_22():
    assert hangar_pad('286') == '00286'


def test_hangar_pad_23():
    assert hangar_pad('299') == '00299'


