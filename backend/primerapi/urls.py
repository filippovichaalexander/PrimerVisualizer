from django.urls import path

from .auth_views import auth_login, auth_register, auth_validate
from .views import design_primers, health_check

urlpatterns = [
    path("auth/register/", auth_register, name="auth-register"),
    path("auth/login/", auth_login, name="auth-login"),
    path("auth/validate/", auth_validate, name="auth-validate"),
    path("design/", design_primers, name="design-primers"),
    path("health/", health_check, name="health-check"),
]

