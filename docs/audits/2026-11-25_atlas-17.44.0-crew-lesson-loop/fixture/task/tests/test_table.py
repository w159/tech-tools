from kit.table import render


def test_shape():
    lines = render(["a", "bb"], [[1, 2], [30, 4]]).splitlines()
    assert len(lines) == 4
    assert "a" in lines[0] and "bb" in lines[0]
