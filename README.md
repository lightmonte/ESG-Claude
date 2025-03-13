# ESG-Claude

A specialized tool for extracting Environmental, Social, and Governance (ESG) data from company sustainability reports using Anthropic's Claude AI.

## Overview

ESG-Claude analyzes PDF documents and extracts structured information about companies' ESG initiatives based on industry-specific criteria. It provides a comprehensive framework for:

1. Loading company data and PDF URLs
2. Extracting ESG data using Claude's powerful AI capabilities
3. Exporting results to various formats (JSON, CSV, Excel)

### Supporting Tools

The project includes several supporting tools in the `tools/` directory:

```bash
# Diagnose Anthropic SDK issues (especially for batch processing)
npm run diagnose:sdk

# Fix SDK installation issues
npm run fix:sdk
```

See the [tools README](tools/README.md) for more details.

## Project Structure

### Core Components

- **Main Application** (`index.js`): Orchestrates the entire process
- **Claude Integration**:
  - `claude-extractor.js`: Direct extraction from PDFs
  - `claude-batch-extractor.js`: Batch processing for multiple PDFs
- **Data Management**:
  - `persistence.js`: SQLite database for tracking extraction status
  - `token-tracker.js`: Records API token usage and generates reports
  - `esg-criteria.js`: Industry-specific ESG criteria
- **Output Handling**:
  - `exporter.js`: Exports data to various formats (JSON, CSV, Excel)

### Directory Structure

```
esg-Claude/
├── data/                       # Data files
│   ├── company_urls.csv        # Company information and PDF URLs
│   ├── documents/              # Sample PDF documents
│   ├── IndustryCriteria.csv    # Industry-specific criteria mappings
│   └── esg_database.sqlite     # SQLite database for tracking status
├── output/                     # Generated output files
│   ├── extracted/              # Extracted ESG data as JSON
│   └── raw_responses/          # Raw API responses for debugging
├── src/
│   ├── index.js                # Main entry point
│   ├── config.js               # Configuration management
│   ├── claude-extractor.js     # Direct PDF extraction
│   ├── claude-batch-extractor.js # Batch extraction
│   ├── exporter.js             # Export functionality
│   ├── utils.js                # Utility functions
│   ├── lib/                    # Library modules
│   │   ├── persistence.js      # Database operations
│   │   ├── esg-criteria.js     # Industry-specific criteria
│   │   ├── token-tracker.js    # Token usage tracking
│   │   ├── error-handler.js    # Centralized error handling
│   │   └── data/               # Data definitions
│   │       └── criteria-descriptions.js # ESG criteria descriptions
│   └── prompts/                # Claude prompt templates
│       ├── system-prompt.js    # System prompts
│       └── user-prompt.js      # User prompts
└── .env                        # Environment variables
```

## Setup and Configuration

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example`:
   ```
   CLAUDE_API_KEY=your_api_key_here
   CLAUDE_MODEL=claude-3-7-sonnet-20250219
   MAX_CONCURRENT_EXTRACTIONS=3
   USE_BATCH_PROCESSING=false
   ```
4. Prepare your `company_urls.csv` file with the following columns:
   - `name` - Company name
   - `url` - URL to the PDF sustainability report
   - `industry` - Industry identifier (used for criteria selection)
   - `shouldUpdate` - Whether to process this company (true/false)

## Usage

### Running Extractions

```bash
# Run the entire pipeline (extraction and export)
npm start

# Run with development auto-restart
npm run dev

# Export only
npm run export

# Export to Excel specifically
npm run export:excel

# Check batch status
npm run check-batches

# Reset extraction status
npm run reset
```

### Batch Processing

By default, the system processes PDFs one by one. For cost efficiency with large volumes, you can enable batch processing:

```
USE_BATCH_PROCESSING=true
BATCH_SIZE=50
BATCH_CHECK_INTERVAL_MINUTES=15
```

> **Note**: Batch processing requires Anthropic SDK version 0.19.0 or later. The default installation uses 0.18.0 which does not support batch API. To upgrade, run `npm run upgrade:sdk`.

#### Monitoring Batch Processing

Batch processing can take time, and you may want to monitor progress and automatically run the exporter when batches complete. Use the monitoring script:

```bash
# Monitor the most recent active batch
npm run monitor

# Monitor a specific batch ID
npm run monitor -- --batchId=msgbatch_01AbCdEfGhIjKlMnOpQrStUv

# Customize check interval (in seconds)
npm run monitor -- --interval=60
```

The monitor will:
- Show real-time progress with a visual indicator
- Estimate completion time
- Automatically process results and run the exporter when complete

## Key Features

- **Industry-Specific Analysis**: Tailors extraction based on company industry
- **Batch Processing**: Cost-effective batch processing of multiple documents
- **Data Export**: Exports to JSON, CSV, and Excel formats
- **Status Tracking**: Tracks extraction status and handles retries
- **Token Usage**: Monitors and reports on API token usage and costs

## ESG Criteria

The system uses industry-specific ESG criteria as defined in `IndustryCriteria.csv`. Each industry has 7 specific criteria to extract data for. Detailed descriptions of each criterion are available in `src/lib/data/criteria-descriptions.js`.

## Output Formats

The system generates several output files:

1. **JSON files** in `output/extracted/{company_id}_extracted.json`
2. **Raw API responses** in `output/raw_responses/{company_id}_raw_response.txt`
3. **Consolidated exports** in `output/` (CSV, Excel)
4. **Token usage reports** in `output/token_usage_report_{timestamp}.txt`

## Error Handling

The system includes robust error handling:

- Retries with exponential backoff for API rate limiting
- JSON parsing with multiple fallback strategies
- Detailed error logging and status tracking

## Extending the Tool

### Adding New Industries

To add new industry mappings:
1. Add entries to `IndustryCriteria.csv`
2. Update the `industryMap` in `src/lib/esg-criteria.js` if needed

### Modifying Prompts

The Claude prompts are now externalized in the `src/prompts` directory. You can modify:

- `system-prompt.js` - For the system instruction to Claude
- `user-prompt.js` - For the user instruction with the extraction request

### Adding New Criteria

To add new criteria:
1. Update `criteria-descriptions.js` with the new criterion details
2. Add the criterion to the relevant industries in `IndustryCriteria.csv`

## License

[Include license information here]
