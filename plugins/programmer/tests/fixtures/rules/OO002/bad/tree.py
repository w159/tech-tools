class Base:
    pass


class Animal(Base):
    pass


class Mammal(Animal):
    pass


class Dog(Mammal):  # expect: OO002
    pass
