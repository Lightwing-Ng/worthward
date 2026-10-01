"""Econometric direct-horizon Price Field models. Code version: v1.0.0.

The modules in this package are numpy-only ports of the frozen round-2
research specifications: a shared Bayesian Sharpe drift (location), three
scale models (HAR Range, Score-Driven, Rough Volatility), and the CRPS
Learning combination of those scale models. Every forecast row uses bars up
to its own origin only.
"""
