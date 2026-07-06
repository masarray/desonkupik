---
name: Feature request
description: Suggest an improvement or new feature
title: "feature: "
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem should this solve?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
      description: Describe the feature or improvement.
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Area
      options:
        - Audio engine
        - UI/UX
        - Desktop packaging
        - Web app
        - Documentation
        - Release workflow
        - Other
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
---
