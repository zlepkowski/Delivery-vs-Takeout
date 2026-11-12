"""Differential oracle runner.

Phase 2 adds an independent Python implementation of BUILD.md section 4.2
(written by the orchestrator, never by the builder) and a fuzzer that checks
the JS engine against it to the cent on randomized scenarios.

Until then this runner is a no-op so `npm test` stays green.
"""
import sys

print("oracle: no reference engine yet (arrives in Phase 2)")
sys.exit(0)
