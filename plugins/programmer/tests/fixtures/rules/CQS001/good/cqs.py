class Counter:
    def __init__(self):
        self.count = 0
        self._total = None

    def get_count(self):
        return self.count

    def get_total(self):
        if self._total is None:
            self._total = self.count * 2
        return self._total

    def increment(self):
        self.count += 1
        return self.count
