---
title: Configuration Overview
---

# Configuration

Configuration in Routa is mainly about making execution available and predictable.

The most important configuration areas are:

- providers
- models
- role defaults
- environment variables

## Recommended Setup Order

1. Make one provider available.
2. Add or pick one model if that provider needs an explicit model target.
3. Bind defaults for the roles you care about.
4. Return to a workspace and run a `Session`.

## Start Here

- [Providers and Models](/configuration/providers-and-models)
- [Environment Variables](/configuration/environment-variables)

## Product Context

In the product UI, the configuration surface currently centers on:

- `Providers`
- `Registry`
- `Role Defaults`
- `Models`

Those settings determine which provider is available, how a model endpoint is resolved, and
which defaults Routa uses for roles like `ROUTA`, `CRAFTER`, `GATE`, and `DEVELOPER`.

## Practical Rule

Do not try to configure every provider before your first run. One working provider and one
working model path are enough.
