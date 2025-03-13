# ESG-Claude Tools

This directory contains utility scripts for troubleshooting and managing the ESG-Claude application. These tools are not part of the core application flow but can be useful for maintenance and diagnostics.

## Available Tools

### SDK Diagnostics

- **diagnose-sdk.js**: Diagnoses issues with the Anthropic SDK installation and tests the availability of the batch API.
  ```bash
  node tools/diagnose-sdk.js
  ```

- **fix-sdk.js**: Attempts to fix SDK installation issues with a complete reinstall.
  ```bash
  node tools/fix-sdk.js
  ```

## Usage

Run these tools from the project root directory. For example:

```bash
# Diagnose SDK issues
node tools/diagnose-sdk.js

# Fix SDK issues
node tools/fix-sdk.js
```

These tools are particularly useful when troubleshooting batch processing functionality, which requires Anthropic SDK version 0.19.0 or higher.
