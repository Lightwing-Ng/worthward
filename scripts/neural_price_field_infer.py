"""One-shot JSON pipe entrypoint for neural forecast inference. Code version: v1.0.0."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys


def main() -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ["WORTHWARD_NEURAL_INFERENCE_WORKER"] = "1"
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
    request = json.load(sys.stdin)
    import numpy as np
    import torch
    from strategies.neural_price_field_compute import walk_forward_neural_predictions
    from strategies.neural_price_field_runtime import forecast_payload

    # This child owns its runtime. Limit launch overhead and avoid multiplying
    # native thread pools when the application already has active workloads.
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))

    def progress(current, total):
        print(json.dumps({"event": "progress", "current": current, "total": total}), flush=True)

    result = walk_forward_neural_predictions(
        np.asarray(request["features"], dtype=float), np.asarray(request["closes"], dtype=float),
        architecture=request["architecture"], params=request["params"],
        feature_names=request["feature_names"], progress=progress,
        min_training_seconds=float(request["min_training_seconds"]),
    )
    print(json.dumps({"event": "result", "forecast": forecast_payload(result)}, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        raise SystemExit(1) from None
