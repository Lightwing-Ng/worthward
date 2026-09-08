"""Compact published forecasting cores adapted to direct Gaussian marginals.

Code version: v1.0.0

These independently implemented, randomly initialized models retain the defining
operations of iTransformer, TiDE, and ModernTCN. Their two-parameter marginal
head is a Worthward adaptation, not a reproduction of published trading results.
Inputs contain historical values followed by their observation masks. No model
uses unobserved future covariates or inference-batch statistics.

Architecture references:
https://arxiv.org/abs/2310.06625
https://arxiv.org/abs/2304.08424
https://openreview.net/forum?id=vpJMJerXHU
"""

from __future__ import annotations

from typing import Any


def make_extended_model(
        torch: Any,
        architecture: str,
        lookback: int,
        channels: int,
        hidden: int,
        dropout: float,
        patch_length: int,
        horizons: int = 20,
) -> Any:
    """Build a lazy-Torch core: ``[B, L, values+mask] -> [B, H, 2]``.

    The caller owns training-only scaling, Gaussian NLL, initialization of final
    heads, device placement, and random-state isolation. Column zero is the
    endogenous return. Observation masks belong to their original variables;
    they are never treated as additional assets or measured future values.
    """
    if architecture not in {"itransformer", "tide", "moderntcn", "tft"}:
        raise ValueError(f"Unknown extended neural architecture: {architecture}")
    for name, value, minimum in (
        ("lookback", lookback, 1), ("channels", channels, 2),
        ("hidden", hidden, 2), ("patch_length", patch_length, 1), ("horizons", horizons, 1),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"Model {name} must be an integer of at least {minimum}.")
    if channels % 2:
        raise ValueError("Models require paired value/mask channels.")
    if not 0 <= dropout < 1:
        raise ValueError("Model dropout must be in [0, 1).")
    if architecture == "tft":
        from strategies.neural_price_field_tft import make_tft_model

        return make_tft_model(torch, lookback, channels, hidden, dropout, horizons)

    nn = torch.nn
    variables = channels // 2
    heads = next(count for count in (4, 2, 1) if hidden % count == 0)

    class ITransformer(nn.Module):
        """Embed complete variable histories, then attend across variables."""

        def __init__(self):
            super().__init__()
            self.value_embedding = nn.Linear(lookback, hidden)
            self.mask_embedding = nn.Linear(lookback, hidden, bias=False)
            layer = nn.TransformerEncoderLayer(
                hidden, heads, hidden * 2, dropout, batch_first=True, activation="gelu",
            )
            self.variable_encoder = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
            self.head = nn.Linear(hidden, horizons * 2)

        def forward(self, values):
            historical = values[:, :, :variables].transpose(1, 2)
            observed = values[:, :, variables:].transpose(1, 2)
            tokens = self.value_embedding(historical) + self.mask_embedding(observed)
            encoded = self.variable_encoder(tokens)
            return self.head(encoded[:, 0]).reshape(len(values), horizons, 2)

    class ResidualDense(nn.Module):
        """TiDE residual dense block with a projected skip and layer norm."""

        def __init__(self, input_width, output_width, expansion):
            super().__init__()
            self.network = nn.Sequential(
                nn.Linear(input_width, expansion), nn.ReLU(), nn.Dropout(dropout),
                nn.Linear(expansion, output_width), nn.Dropout(dropout),
            )
            self.skip = nn.Identity() if input_width == output_width else nn.Linear(input_width, output_width)
            self.norm = nn.LayerNorm(output_width)

        def forward(self, values):
            return self.norm(self.network(values) + self.skip(values))

    class TiDE(nn.Module):
        """Residual dense encoder/decoder with shared temporal decoding.

        Exogenous inputs are past-only. A learned horizon index provides the
        decoder's known future context; actual future market factors are absent.
        """

        def __init__(self):
            super().__init__()
            context_width = min(8, hidden)
            decoder_width = max(4, hidden // 2)
            self.covariate_projection = (
                ResidualDense(2 * (variables - 1), context_width, hidden)
                if variables > 1 else None
            )
            historical_width = lookback * (2 + (context_width if variables > 1 else 0))
            self.encoder = nn.Sequential(
                ResidualDense(historical_width, hidden, hidden * 2),
                ResidualDense(hidden, hidden, hidden * 2),
            )
            self.dense_decoder = ResidualDense(hidden, horizons * decoder_width, hidden * 2)
            self.horizon_context = nn.Parameter(torch.zeros(horizons, context_width))
            self.temporal_decoder = ResidualDense(decoder_width + context_width, hidden, hidden * 2)
            self.residual_head = nn.Linear(lookback, horizons)
            self.head = nn.Linear(hidden, 2)

        def forward(self, values):
            target_history = values[:, :, [0, variables]]
            history = target_history.flatten(1)
            if self.covariate_projection is not None:
                exogenous = torch.cat((values[:, :, 1:variables], values[:, :, variables + 1:]), dim=-1)
                history = torch.cat((history, self.covariate_projection(exogenous).flatten(1)), dim=-1)
            decoded = self.dense_decoder(self.encoder(history)).reshape(len(values), horizons, -1)
            future_context = self.horizon_context.unsqueeze(0).expand(len(values), -1, -1)
            raw = self.head(self.temporal_decoder(torch.cat((decoded, future_context), dim=-1)))
            return torch.stack((raw[:, :, 0] + self.residual_head(values[:, :, 0]), raw[:, :, 1]), dim=-1)

    class ModernTCNBlock(nn.Module):
        """Large temporal kernels and both grouped pointwise mixing stages."""

        def __init__(self, patches):
            super().__init__()
            expanded_channels = variables * hidden
            large_kernel = max(3, min(31, 2 * patches - 1))
            self.large_depthwise = nn.Conv1d(
                expanded_channels, expanded_channels, large_kernel,
                padding=large_kernel // 2, groups=expanded_channels,
            )
            self.small_depthwise = nn.Conv1d(
                expanded_channels, expanded_channels, 3, padding=1, groups=expanded_channels,
            )
            self.temporal_norm = nn.LayerNorm(hidden)
            self.channel_norm = nn.LayerNorm(hidden)
            self.variable_norm = nn.LayerNorm(variables)
            self.channel_mixing = nn.Sequential(
                nn.Conv1d(expanded_channels, expanded_channels * 2, 1, groups=variables),
                nn.GELU(), nn.Dropout(dropout),
                nn.Conv1d(expanded_channels * 2, expanded_channels, 1, groups=variables),
                nn.Dropout(dropout),
            )
            self.variable_mixing = nn.Sequential(
                nn.Conv1d(expanded_channels, expanded_channels * 2, 1, groups=hidden),
                nn.GELU(), nn.Dropout(dropout),
                nn.Conv1d(expanded_channels * 2, expanded_channels, 1, groups=hidden),
                nn.Dropout(dropout),
            )
            self.dropout = nn.Dropout(dropout)

        def forward(self, values):
            batch, _, _, patches = values.shape
            flattened = values.reshape(batch, variables * hidden, patches)
            temporal = self.large_depthwise(flattened) + self.small_depthwise(flattened)
            temporal = temporal.reshape(batch, variables, hidden, patches)
            temporal = self.temporal_norm(temporal.transpose(2, 3)).transpose(2, 3)
            values = values + self.dropout(temporal)
            channel_input = self.channel_norm(values.transpose(2, 3)).transpose(2, 3)
            channel_update = self.channel_mixing(channel_input.reshape(batch, variables * hidden, patches))
            values = values + channel_update.reshape(batch, variables, hidden, patches)
            # Groups=variables mixes learned channels within each variable;
            # groups=hidden then mixes variables within each learned channel.
            variable_input = values.permute(0, 2, 3, 1)
            variable_input = self.variable_norm(variable_input).permute(0, 1, 3, 2)
            variable_update = self.variable_mixing(variable_input.reshape(batch, hidden * variables, patches))
            return values + variable_update.reshape(batch, hidden, variables, patches).transpose(1, 2)

    class ModernTCN(nn.Module):
        """One compact ModernTCN block with paired per-variable patch inputs."""

        def __init__(self):
            super().__init__()
            self.patch_length = min(lookback, patch_length)
            self.stride = max(1, self.patch_length // 2)
            # Align the final patch to the current origin. Any incomplete
            # stride belongs to the oldest prefix, never the latest close.
            self.prefix_offset = (lookback - self.patch_length) % self.stride
            self.patches = 1 + (lookback - self.patch_length) // self.stride
            self.patch_embedding = nn.Linear(self.patch_length * 2, hidden)
            self.block = ModernTCNBlock(self.patches)
            self.head = nn.Linear(hidden * self.patches, horizons * 2)

        def forward(self, values):
            paired = torch.stack((values[:, :, :variables], values[:, :, variables:]), dim=2)
            paired = paired.permute(0, 3, 2, 1)[..., self.prefix_offset:]
            paired = paired.unfold(-1, self.patch_length, self.stride)
            patches = paired.permute(0, 1, 3, 2, 4).reshape(
                len(values), variables, self.patches, self.patch_length * 2,
            )
            embedded = self.patch_embedding(patches).transpose(2, 3)
            target = self.block(embedded)[:, 0].flatten(1)
            return self.head(target).reshape(len(values), horizons, 2)

    model = {"itransformer": ITransformer, "tide": TiDE, "moderntcn": ModernTCN}[architecture]()
    model.architecture = architecture
    return model
