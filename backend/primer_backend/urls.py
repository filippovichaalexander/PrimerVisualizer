from django.contrib import admin
from django.urls import path, include

from primerapi.views import root_info

urlpatterns = [
    path("", root_info),
    path("admin/", admin.site.urls),
    path("api/", include("primerapi.urls")),
]

