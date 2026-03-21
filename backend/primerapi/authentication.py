"""DRF token auth с префиксом Authorization: Bearer <key> (как в расширении)."""

from rest_framework.authentication import TokenAuthentication


class BearerTokenAuthentication(TokenAuthentication):
    keyword = "Bearer"
