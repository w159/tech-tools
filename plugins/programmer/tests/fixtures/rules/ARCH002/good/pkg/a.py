from typing import TYPE_CHECKING

from pkg import c

if TYPE_CHECKING:
    from pkg import b


def f():
    return c.h()
