from enum import Enum


class Subway(Enum):
    RED = "red"
    MATTAPAN = "mattapan"
    ORANGE = "orange"
    BLUE = "blue"
    GREEN_B = "green_b"
    GREEN_C = "green_c"
    GREEN_D = "green_d"
    GREEN_E = "green_e"


class SilverLine(Enum):
    SL1 = "sl1"
    SL2 = "sl2"
    SL3 = "sl3"
    SL4 = "sl4"
    SL5 = "sl5"
    SLW = "slw"


SUBWAY_ROUTE_IDS = {
    Subway.RED: "Red",
    Subway.MATTAPAN: "Mattapan",
    Subway.ORANGE: "Orange",
    Subway.BLUE: "Blue",
    Subway.GREEN_B: "Green-B",
    Subway.GREEN_C: "Green-C",
    Subway.GREEN_D: "Green-D",
    Subway.GREEN_E: "Green-E",
}

SILVER_LINE_ROUTE_IDS = {
    SilverLine.SL1: "741",
    SilverLine.SL2: "742",
    SilverLine.SL3: "743",
    SilverLine.SL4: "751",
    SilverLine.SL5: "749",
    SilverLine.SLW: "746",
}

ROUTE_IDS = [
    *[route_id for route_id in SUBWAY_ROUTE_IDS.values()],
    *[route_id for route_id in SILVER_LINE_ROUTE_IDS.values()],
]
