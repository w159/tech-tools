#!/bin/bash
cd "$(dirname "$0")"
P=${ATLAS_PLUGIN:-$(cd ../../../plugins/atlas && pwd)}
prev=""
for i in 1 2 3 4 5; do
  if [ -n "$prev" ] && [ -f "runs/$prev/lessons.json" ]; then s="--store-in runs/$prev/lessons.json"; else s=""; fi
  python3 bench.py --fixture fixture --plugin $P --tag N$i --learn on $s 2>&1 | tail -1
  prev=N$i
done
