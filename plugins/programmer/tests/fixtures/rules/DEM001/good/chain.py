import os.path
import xml.etree.ElementTree as ET


def path_of(name):
    return os.path.join(os.path.dirname(name), "x")


def parse(text):
    return ET.fromstring(text).find("a")


class Report:
    def owner(self):
        return self.account.owner.name


def label(parts):
    return ", ".join(parts).strip().upper()


def zip_of(order):
    return order.shipping_zip()
