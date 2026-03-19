from django.urls import path

from .views import design_primers, health_check

urlpatterns = [
    path("design/", design_primers, name="design-primers"),
    path("health/", health_check, name="health-check"),
]

