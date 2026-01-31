# Testing 101 — Learn Like a Baby

This doc explains **what tests are**, **why we have them**, and **how to use them** in this project. No prior testing knowledge needed.

---

## 1. What is a test?

A **test** is a small program that **checks that your app does what you expect**.

- You run it. It either **pass** (green) or **fail** (red).
- If you change code later and break something, the test fails and tells you *what* broke.

Think of it like: “When I push this button, does the right thing happen?” A test is that check, written in code, so the computer can run it every time.

---

## 2. Why do we test?

- **Safety:** Change code (e.g. fix a bug or add a feature) without silently breaking something else.
- **Documentation:** Tests show how the app is *supposed* to behave.
- **Confidence:** Before you deploy or demo, run tests. If they pass, the core flows probably work.

You don’t need 100 tests. A few **high‑value** tests (like the ones in this project) are enough to catch big mistakes.

---

## 3. What do we test in this project?

We have **6 tests** that cover the most important behavior:

| What we check | In plain English |
|---------------|------------------|
| **Create scheduled** | Guest can request their car “in 1 min” and we create a SCHEDULED request. |
| **Tick flips once** | When the scheduler runs, one SCHEDULED request becomes REQUESTED. |
| **Second tick does nothing** | Running the scheduler again doesn’t flip the same request twice. |
| **Idempotent request** | If the guest clicks “Request” again while they already have an active request, we return “you already have one” (idempotent), not a duplicate. |
| **Valet can’t reset demo** | A valet user cannot call “reset demo” (only managers can). |
| **Guest can’t call protected APIs** | Someone without a login token cannot call manager/valet-only APIs (they get 401). |

So: **scheduling**, **idempotency**, and **who is allowed to do what** (auth).

---

## 4. How do I run the tests?

From the **project root** (the folder that has `Makefile` and `backend/`):

```bash
make test
```

That’s it. You don’t need the app running or Postgres for these tests; they use a tiny in-memory database.

You can also run them from inside `backend/`:

```bash
cd backend
DATABASE_URL=sqlite:///:memory: python -m pytest tests/ -v
```

- `-v` = “verbose” — you see each test name and pass/fail.

---

## 5. How do I read the result?

After you run `make test`, you’ll see something like:

```
tests/test_core_flows.py::test_create_scheduled PASSED
tests/test_core_flows.py::test_second_request_returns_idempotent PASSED
tests/test_core_flows.py::test_valet_cannot_reset_demo PASSED
tests/test_core_flows.py::test_guest_cannot_call_protected_endpoints PASSED
...
==================== 4 passed, 2 skipped ====================
```

- **PASSED** = that behavior works as we expect.
- **SKIPPED** = we don’t run that test in this setup (e.g. scheduler tick tests are skipped when using SQLite).
- **FAILED** = something is wrong; the output below will say *which* test failed and often *which line* or *which assertion*.

If something **FAILED**, read the last part of the output: it usually says something like “AssertionError: expected X, got Y” or “401 != 200”. That tells you what broke.

---

## 6. Where is the test code?

- **Tests:** `backend/tests/test_core_flows.py`
- **Fixtures (test data and setup):** `backend/tests/conftest.py`

You don’t have to understand every line. Skim the **test names** and the **short docstrings** under each test — they describe what we’re checking.

---

## 7. How does one test look? (Simple example)

A test is just a function that:

1. **Prepares** some data (or uses fixtures from `conftest.py`).
2. **Does something** (e.g. calls an API with the test client).
3. **Asserts** that the result is what we expect.

Example (simplified):

```python
def test_guest_cannot_call_protected_endpoints(client):
    # Do something: call an API without a login token
    r = client.post("/api/scheduler/tick", json={})

    # Assert: we expect "unauthorized" (401)
    assert r.status_code == 401
```

- `client` is a fixture (a fake “browser” that hits your API).
- `assert` means “this must be true; if not, the test fails”.

So: “When a guest (no token) calls the scheduler tick endpoint, we expect 401.” That’s the whole idea.

---

## 8. Best habits (the “best of testing” in one paragraph)

- Run tests **before** you push or deploy: `make test`.
- Add a test when you fix a **bug** (so it doesn’t come back).
- Add a test when you add a **critical behavior** (e.g. “only manager can reset”).
- Keep tests **short and clear**: one idea per test, name and docstring say what we’re checking.
- Don’t chase 100% coverage; a few **high‑value** tests (like ours) are enough to start.

---

## 9. Quick reference

| I want to… | Do this |
|------------|--------|
| Run all tests | `make test` (from project root) |
| Run tests with more output | `cd backend && DATABASE_URL=sqlite:///:memory: python -m pytest tests/ -v` |
| Run one test | `cd backend && DATABASE_URL=sqlite:///:memory: python -m pytest tests/test_core_flows.py::test_guest_cannot_call_protected_endpoints -v` |
| See what tests exist | Open `backend/tests/test_core_flows.py` and read the function names and docstrings |

That’s testing in this project, explained step by step. Run `make test` whenever you want to check that the core flows still work.
