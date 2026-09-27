---
name: dc-project-documentation
description: "Estructura y organiza la documentación técnica y de producto de DC Studio: arquitectura, ADRs (decisiones técnicas), MVP, requisitos, discovery y onboarding. Complementa cognitive-doc-design definiendo dónde y qué registrar sin sobrecargar el contexto."
license: MIT
metadata:
  author: dc-studio
  version: "1.0"
---

# DC Project Documentation

## Propósito y Complementariedad con Gentle AI
Esta skill define la **taxonomía y ubicación de los documentos** (`docs/`), mientras que `cognitive-doc-design` define **cómo redactarlos** para minimizar la carga cognitiva del lector.

## Activation Contract

Use this skill when the user asks to document a software project, route a project-documentation decision, or decide which modular Markdown artifact owns a fact or decision.

This is the one lightweight documentation router. It selects exactly one canonical owner for the current decision and then stops. It does not create another Pi workflow, authorize implementation, scan code, define product scope, choose architecture, select technology, plan delivery, or validate product outcomes.

Prefer direct path ownership when the request names a `docs/` path. Prefer intent ownership when no path is supplied. Read only the selected internal owner module and mandatory guardrails needed for that owner; do not fan out across the lifecycle.

## Canonical Scope

This skill owns only:

- documentation intent classification;
- canonical owner selection;
- avoidance of lifecycle-wide context loading; and
- the readiness boundary between documentation and Pi execution workflows.

It does not own:

- shared Markdown structure and traceability details, which remain in `references/document-contract.md`;
- AS_IS evidence reconstruction, owned by `references/owners/existing-project-onboarding.md`;
- product discovery, definition, requirements, architecture, ADRs, delivery, or validation module content; or
- Direct Orchestrator or Planned Workflow execution routing.

## Hard Rules

- Load and follow `anti-overengineering` whenever this skill is active.
- Select one current documentation owner module. Do not load every lifecycle module.
- If several owners could apply, route to the first unresolved upstream decision rather than downstream documents.
- Use existing approved artifacts as authority; do not restart discovery or onboarding when current contracts already answer the request.
- Do not create placeholder documentation trees or speculative future documents.
- Do not treat `phase`, `stage`, `etapa`, `milestone`, or `sprint` as product structure by default. Decide whether the term means current product scope, future extension/exclusion, or delivery sequencing.
- Documentation defines and traces decisions. Code changes still proceed only through Direct Orchestrator or Planned Workflow after workflow triage.
- Keep registry `related` minimal. Owner-specific handoffs are selected from the routing table, not by automatic related expansion.

## Routing Table

| User intent or path | Internal owner module to read next |
|---|---|
| New app, new startup/project idea, organize lifecycle docs, or unknown documentation owner | `references/owners/startup-documentation.md` |
| Existing codebase scan, legacy project docs, AS_IS baseline, reconstruct docs from implementation | `references/owners/existing-project-onboarding.md` |
| Problem, users, evidence, assumptions, opportunity, initial direction | `references/owners/product-discovery.md` |
| Product vision, outcomes, MVP hypothesis, scope, journeys, capabilities | `references/owners/product-definition.md` |
| Functional behavior, business rules, acceptance criteria, quality requirements, constraints | `references/owners/requirements-definition.md` |
| Architecture drivers, system context, boundaries, data/trust, deployment view | `references/owners/architecture-definition.md` |
| ADR, technology/dependency/vendor/datastore/protocol/integration decision | `references/owners/technical-decisions.md` |
| Roadmap, delivery model, increment, sprint, Definition of Done, release sequencing | `references/owners/delivery-planning.md` |
| Measurement plan, experiment, outcome evidence, learning decision, change request | `references/owners/product-validation.md` |
| Pure readability/reviewability rewrite of an existing doc without semantic change | `cognitive-doc-design` skill, only when presentation is the actual task |

## Execution Steps

1. Identify whether the request is documentation-only or whether it also asks for implementation/workflow execution.
2. Match the request by explicit path first, then by the smallest unresolved decision in the routing table.
3. Read exactly the selected owner module plus `anti-overengineering` when not already loaded.
4. Apply the selected module only to the current decision, known approved context, relevant path, exclusions, and next expected artifact.
5. If implementation is requested after documentation readiness, route execution separately through Direct Orchestrator or Planned Workflow.
6. Regenerate the skill registry and run routing checks only when skill definitions or routing metadata changed.

## Output Contract

Return:

- Skill applied: `project-documentation`.
- Selected owner module and why.
- Other owner modules deliberately not loaded.
- Documentation path or decision being routed.
- Whether implementation workflow routing is required next.
- Blockers or user-owned decisions, or `None`.

## References

- `references/document-contract.md` — shared modular Markdown contract.
- `references/owners/startup-documentation.md` — new-project lifecycle initialization.
- `references/owners/existing-project-onboarding.md` — existing-codebase AS_IS reconstruction.
- `~/.pi/agent/skills/anti-overengineering/SKILL.md` — mandatory scope control.
- `~/.pi/agent/AGENTS.md` — Pi workflow boundaries and delegation policy.
