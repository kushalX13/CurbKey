from functools import wraps

from flask import abort, g
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from app.models import User


def get_current_user():
    user_id = get_jwt_identity()
    if not user_id:
        return None
    return User.query.get(int(user_id))


def require_role(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = get_current_user()
            if not user or user.role not in roles:
                abort(403, "forbidden")
            g.user = user
            return fn(*args, **kwargs)

        return wrapper

    return decorator
