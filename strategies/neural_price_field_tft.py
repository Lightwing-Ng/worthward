"""Compact Temporal Fusion Transformer for direct Gaussian return marginals.

The local implementation follows TFT's variable selection, gated residuals,
local recurrence, and shared-value interpretable attention. Horizon indices are
the only known future input. Learned neutral contexts replace absent static
attributes; they are model intercepts, not invented asset metadata. The common
Gaussian head is a Worthward adaptation of TFT's original quantile head.

Primary reference: https://arxiv.org/abs/1912.09363
Code version: v1.0.0
"""

from __future__ import annotations

import math
from typing import Any


def make_tft_model(
    torch: Any,
    lookback: int,
    channels: int,
    hidden: int,
    dropout: float,
    horizons: int = 20,
) -> Any:
    """Build a lazy-Torch core mapping observed values/masks to raw mean/scale.

    Inputs have shape ``[batch, lookback, 2 * features]``. The first half
    contains standardized observations and the second half their observation
    masks (one for observed, zero for missing). Outputs are raw ``[batch,
    horizons, 2]`` mean and log standard deviation in the shared target units.
    The caller owns training-only scaling, scale bounds, and Gaussian NLL.
    """
    for name, value, minimum in (
        ("lookback", lookback, 1), ("channels", channels, 2),
        ("hidden", hidden, 2), ("horizons", horizons, 1),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"TFT {name} must be an integer of at least {minimum}.")
    if channels % 2:
        raise ValueError("TFT requires paired observation and mask channels.")
    if not math.isfinite(float(dropout)) or not 0.0 <= dropout < 1.0:
        raise ValueError("TFT dropout must be finite and in [0, 1).")

    nn = torch.nn
    features = channels // 2
    heads = next(candidate for candidate in (4, 2, 1) if hidden % candidate == 0)
    attention_width = hidden // heads

    class GatedResidualNetwork(nn.Module):
        def __init__(self, input_width, output_width=hidden, *, context=False):
            super().__init__()
            self.input = nn.Linear(input_width, hidden)
            self.context = nn.Linear(hidden, hidden, bias=False) if context else None
            self.activation = nn.ELU()
            self.output = nn.Linear(hidden, output_width)
            self.dropout = nn.Dropout(dropout)
            self.gate = nn.Linear(output_width, output_width * 2)
            self.skip = nn.Identity() if input_width == output_width else nn.Linear(input_width, output_width)
            self.norm = nn.LayerNorm(output_width)

        def forward(self, values, context=None):
            intermediate = self.input(values)
            if self.context is not None and context is not None:
                projected = self.context(context)
                while projected.ndim < intermediate.ndim:
                    projected = projected.unsqueeze(1)
                intermediate = intermediate + projected
            transformed = self.dropout(self.output(self.activation(intermediate)))
            gated = nn.functional.glu(self.gate(transformed), dim=-1)
            return self.norm(self.skip(values) + gated)

    class GateAddNorm(nn.Module):
        def __init__(self):
            super().__init__()
            self.dropout = nn.Dropout(dropout)
            self.gate = nn.Linear(hidden, hidden * 2)
            self.norm = nn.LayerNorm(hidden)

        def forward(self, values, residual):
            gated = nn.functional.glu(self.gate(self.dropout(values)), dim=-1)
            return self.norm(residual + gated)

    class VariableSelection(nn.Module):
        def __init__(self):
            super().__init__()
            self.embeddings = nn.ModuleList(nn.Linear(2, hidden) for _ in range(features))
            self.transforms = nn.ModuleList(GatedResidualNetwork(hidden) for _ in range(features))
            self.weight_network = GatedResidualNetwork(features * hidden, features, context=True)

        def forward(self, values, context):
            masks = values[..., features:]
            observed = values[..., :features] * masks
            paired = torch.stack((observed, masks), dim=-1)
            embedded = [embedding(paired[..., index, :]) for index, embedding in enumerate(self.embeddings)]
            weights = torch.softmax(self.weight_network(torch.cat(embedded, dim=-1), context), dim=-1)
            transformed = torch.stack(
                [network(value) for network, value in zip(self.transforms, embedded, strict=True)], dim=-2,
            )
            return (transformed * weights.unsqueeze(-1)).sum(dim=-2), weights

    class InterpretableAttention(nn.Module):
        def __init__(self):
            super().__init__()
            self.query = nn.Linear(hidden, hidden, bias=False)
            self.key = nn.Linear(hidden, hidden, bias=False)
            self.value = nn.Linear(hidden, attention_width, bias=False)
            self.output = nn.Linear(attention_width, hidden, bias=False)
            self.dropout = nn.Dropout(dropout)
            mask = torch.arange(lookback + horizons).unsqueeze(0) > (
                lookback + torch.arange(horizons).unsqueeze(1)
            )
            self.register_buffer("future_mask", mask, persistent=False)

        def forward(self, sequence):
            batch = sequence.shape[0]
            query = self.query(sequence[:, lookback:]).reshape(batch, horizons, heads, attention_width)
            key = self.key(sequence).reshape(batch, lookback + horizons, heads, attention_width)
            scores = torch.matmul(query.transpose(1, 2), key.permute(0, 2, 3, 1)) / math.sqrt(attention_width)
            scores = scores.masked_fill(self.future_mask, torch.finfo(scores.dtype).min)
            weights = torch.softmax(scores, dim=-1)
            # Every head attends to the same value representation. Averaging
            # the weights preserves TFT's additive, interpretable aggregation.
            averaged = weights.mean(dim=1)
            attended = torch.matmul(self.dropout(averaged), self.value(sequence))
            return self.output(attended), averaged

    class TemporalFusionTransformer(nn.Module):
        def __init__(self):
            super().__init__()
            self.neutral_context = nn.Parameter(torch.zeros(hidden))
            self.selection_context = GatedResidualNetwork(hidden)
            self.enrichment_context = GatedResidualNetwork(hidden)
            self.hidden_context = GatedResidualNetwork(hidden)
            self.cell_context = GatedResidualNetwork(hidden)
            self.variable_selection = VariableSelection()
            self.horizon_embedding = nn.Embedding(horizons, hidden)
            self.known_projection = GatedResidualNetwork(hidden, context=True)
            self.encoder = nn.LSTM(hidden, hidden, batch_first=True)
            self.decoder = nn.LSTM(hidden, hidden, batch_first=True)
            self.local_gate = GateAddNorm()
            self.static_enrichment = GatedResidualNetwork(hidden, context=True)
            self.temporal_attention = InterpretableAttention()
            self.attention_gate = GateAddNorm()
            self.position_network = GatedResidualNetwork(hidden)
            self.output_gate = GateAddNorm()
            self.head = nn.Linear(hidden, 2)
            nn.init.normal_(self.head.weight, std=0.01)
            nn.init.zeros_(self.head.bias)

        def forward(self, values):
            if values.ndim != 3 or tuple(values.shape[1:]) != (lookback, channels):
                raise ValueError(f"TFT expects [batch, {lookback}, {channels}] observations and masks.")
            neutral = self.neutral_context.unsqueeze(0).expand(values.shape[0], -1)
            selection_context = self.selection_context(neutral)
            observed, _ = self.variable_selection(values, selection_context)
            # Future inputs contain only the horizon identity, which is known
            # at every origin. No decoder target or future market factor enters.
            future = self.horizon_embedding.weight.unsqueeze(0).expand(values.shape[0], -1, -1)
            future = self.known_projection(future, selection_context)
            initial_state = (
                self.hidden_context(neutral).unsqueeze(0).contiguous(),
                self.cell_context(neutral).unsqueeze(0).contiguous(),
            )
            past_local, state = self.encoder(observed, initial_state)
            future_local, _ = self.decoder(future, state)
            local = self.local_gate(
                torch.cat((past_local, future_local), dim=1),
                torch.cat((observed, future), dim=1),
            )
            enriched = self.static_enrichment(local, self.enrichment_context(neutral))
            attended, _ = self.temporal_attention(enriched)
            fused = self.attention_gate(attended, enriched[:, lookback:])
            output = self.output_gate(self.position_network(fused), local[:, lookback:])
            return self.head(output)

    return TemporalFusionTransformer()
