class AppError(Exception):
    pass


class DataError(AppError):
    pass


class ParseError(DataError):
    pass


class DeepParseError(ParseError):
    pass


class Base:
    pass


class Animal(Base):
    pass


class Dog(Animal):
    pass
