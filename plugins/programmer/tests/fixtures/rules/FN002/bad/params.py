def create_user(name, email, age, role, team):  # expect: FN002
    return name, email, age, role, team


class Service:
    def configure(self, host, port, user, password, timeout):  # expect: FN002
        return host, port, user, password, timeout
