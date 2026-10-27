class Counter:
    def __init__(self):
        self.count = 0
        self.seen = []

    def get_count(self):
        self.count += 1  # expect: CQS001
        return self.count

    def is_new(self, item):
        self.seen.append(item)  # expect: CQS001
        return item not in self.seen
