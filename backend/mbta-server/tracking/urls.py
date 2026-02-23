from django.urls import path

from . import views

urlpatterns = [
    path("stream/", views.tracking_stream, name="tracking_stream"),
    path("routes/", views.available_route_ids, name="tracking_available_route_ids"),
    path("stations/", views.search_stations, name="tracking_search_stations"),
    path(
        "predictions/", views.station_predictions, name="tracking_station_predictions"
    ),
]
