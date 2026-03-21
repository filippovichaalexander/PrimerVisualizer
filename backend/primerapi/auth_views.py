"""Регистрация, вход и проверка токена для расширения PrimerDesigner."""

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .authentication import BearerTokenAuthentication


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email or "",
        "name": (user.first_name or "").strip() or user.username,
    }


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_register(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""
    name = (request.data.get("name") or "").strip()

    if not email or not password:
        return Response(
            {"detail": "Укажите email и пароль"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(password) < 6:
        return Response(
            {"detail": "Пароль не короче 6 символов"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username=email).exists():
        return Response(
            {"detail": "Пользователь с таким email уже зарегистрирован"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name[:150] if name else "",
    )
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {
            "token": token.key,
            "user": _user_payload(user),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def auth_login(request):
    email = (request.data.get("email") or "").strip().lower()
    password = request.data.get("password") or ""

    if not email or not password:
        return Response(
            {"detail": "Укажите email и пароль"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request, username=email, password=password)
    if user is None:
        return Response(
            {"detail": "Неверный email или пароль"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {
            "token": token.key,
            "user": _user_payload(user),
        }
    )


@api_view(["GET"])
@authentication_classes([BearerTokenAuthentication])
@permission_classes([IsAuthenticated])
def auth_validate(request):
    return Response({"user": _user_payload(request.user)})
