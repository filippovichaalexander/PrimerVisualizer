from django.urls import path

from .views import design_primers

urlpatterns = [
    path("design/", design_primers, name="design-primers"),
]

