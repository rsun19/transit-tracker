from typing import Any

from django.http import JsonResponse


def error_response(
    *, code: str, message: str, details: Any = None, status: int = 400
) -> JsonResponse:
    return JsonResponse(
        {
            "error": {
                "code": code,
                "message": message,
                "details": details,
            }
        },
        status=status,
    )
