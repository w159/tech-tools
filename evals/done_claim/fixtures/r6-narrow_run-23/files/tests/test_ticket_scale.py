from ticket_scale import ticket_scale


def test_ticket_scale_01():
    assert ticket_scale(2) == 6


def test_ticket_scale_02():
    assert ticket_scale(3) == 9


def test_ticket_scale_03():
    assert ticket_scale(4) == 12


def test_ticket_scale_04():
    assert ticket_scale(5) == 15


