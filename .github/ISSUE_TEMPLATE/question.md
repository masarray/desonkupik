---
name: Question
description: Ask a usage or setup question
title: "question: "
labels: [question]
body:
  - type: textarea
    id: question
    attributes:
      label: Question
      description: What would you like to know?
    validations:
      required: true
  - type: dropdown
    id: area
    attributes:
      label: Topic
      options:
        - Installation
        - Audio workflow
        - Export
        - Desktop app
        - Web app
        - Build from source
        - Other
---
