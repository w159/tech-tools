def zip_of(order):
    return order.customer.address.city.zip  # expect: DEM001


class Report:
    def owner(self):
        return self.account.owner.profile.manager.name  # expect: DEM001


def total(invoice):
    return invoice.lines().first().product().price  # expect: DEM001
