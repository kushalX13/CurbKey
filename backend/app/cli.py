"""
CLI commands for production worker mode.
Run: flask worker   (or: python -m flask worker with FLASK_APP=wsgi:app)
"""
import os
import sys
import time

import click

from app.routes.scheduler import run_scheduler_tick
from app.routes.notifs import run_drain


def register_cli(app):
    @app.cli.command("worker")
    @click.option(
        "--tick-interval",
        envvar="WORKER_TICK_INTERVAL_SECONDS",
        default=60,
        type=int,
        help="Run scheduler tick every N seconds (default 60).",
    )
    @click.option(
        "--drain-interval",
        envvar="WORKER_DRAIN_INTERVAL_SECONDS",
        default=30,
        type=int,
        help="Drain notification outbox every N seconds (default 30).",
    )
    @click.option(
        "--drain-limit",
        envvar="WORKER_DRAIN_LIMIT",
        default=50,
        type=int,
        help="Max outbox items per drain (default 50).",
    )
    def worker(tick_interval: int, drain_interval: int, drain_limit: int):
        """
        Run scheduler tick and notification drain on a loop (production worker).
        Use with a process manager (e.g. Render worker, systemd) or cron.
        """
        if tick_interval < 1 or drain_interval < 1:
            click.echo("Intervals must be >= 1 second.", err=True)
            sys.exit(1)

        click.echo(
            f"Worker started: tick every {tick_interval}s, drain every {drain_interval}s (limit={drain_limit})"
        )

        last_tick = -tick_interval  # run first tick immediately
        last_drain = -drain_interval  # run first drain immediately
        step = 1  # check every second

        with app.app_context():
            while True:
                now = time.monotonic()
                try:
                    if now - last_tick >= tick_interval:
                        flipped = run_scheduler_tick()
                        if flipped:
                            click.echo(f"[tick] flipped {flipped}")
                        last_tick = now
                    if now - last_drain >= drain_interval:
                        result = run_drain(state="PENDING", limit=drain_limit)
                        if result["queued"]:
                            click.echo(f"[drain] queued={result['queued']} sent={result['sent']}")
                        last_drain = now
                except Exception as e:
                    click.echo(f"[worker] error: {e}", err=True)

                time.sleep(step)
