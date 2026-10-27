def create_user(name, email, age, role):
    return name, email, age, role


def forward(*args, **kwargs):
    return args, kwargs


class Service:
    def configure(self, host, port, user, password):
        return host, port, user, password

    @classmethod
    def build(cls, host, port, user, password):
        return cls()
