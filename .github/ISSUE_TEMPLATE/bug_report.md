---
name: Bug report
description: Report a reproducible problem
title: "bug: "
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thank you for helping improve DeSonKuPik.
  - type: input
    id: version
    attributes:
      label: App version
      placeholder: v0.3.83
    validations:
      required: true
  - type: dropdown
    id: platform
    attributes:
      label: Platform
      options:
        - Windows
        - macOS
        - Linux
        - Web
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: What did you do?
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: Actual behavior
    validations:
      required: true
  - type: textarea
    id: extra
    attributes:
      label: Screenshots, logs, or audio notes
---
