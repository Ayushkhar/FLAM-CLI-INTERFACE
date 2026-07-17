#!/bin/sh

# 1. Start the worker processes in the background (using 2 workers)
echo "Starting background workers..."
node dist/index.js worker start --count 2

# 2. Start the web dashboard in the foreground
# Render automatically injects the PORT environment variable
echo "Starting dashboard on port $PORT..."
node dist/index.js dashboard --port $PORT
