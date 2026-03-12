# app

Application package for the antigravity project.

## Layering

- `web.py`
  - HTTP routes and request orchestration
- `market_data.py`
  - Price history retrieval, normalization, and persistence migration
- `comparisons.py`
  - Shared-window alignment and return-series construction
- `date_constraints.py`
  - Exact-range trading-day alignment rules
- `logos.py`
  - Quote profile lookup and logo retrieval
- `presentation.py`
  - Human-readable labels and presentation formatting
- `schemas.py`
  - Lightweight dataclass schemas used across layers
- `storage.py`
  - Persistent path layout under `market_store/`
- `settings.py`
  - Runtime config loading from `config.toml`
- `config.py`
  - Static application constants

## Naming rules

- Prefer short, domain-first module names
- Avoid `*_service.py` suffix sprawl
- Keep route code in `web.py`; keep business logic out of routes
- Keep persistence path logic in `storage.py`
- Keep display wording out of core domain modules

## Boundary rules

- `web.py` may depend on all other modules
- Domain modules should not depend on `web.py`
- `schemas.py` should remain lightweight and reusable
- `settings.py` and `storage.py` are infrastructure helpers, not business logic
