#!/bin/bash
echo "Setting up test environment for batch processing..."

echo "Updating .env file to enable batch processing..."
echo "USE_BATCH_PROCESSING=true" >> .env
echo "BATCH_SIZE=2" >> .env

echo "Running ESG extraction in batch mode..."
npm start

echo ""
echo "Checking batch results..."
npm run check-batches

echo ""
echo "Test completed. Check the output above to see if batch processing worked correctly."
