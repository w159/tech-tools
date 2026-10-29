#!/bin/bash
# usage: wloop.sh <arm> <label-prefix> fixtures...
cd "$(dirname "$0")"; a=$1; p=$2; shift 2
for fx in "$@"; do for i in 1 2 3; do
  FIX=$fx bash arm3w.sh $a $p-$i >/dev/null 2>&1
  python3 -c "import json;d=json.load(open('runs/$fx-$a-$p-$i/result.json'));print('$fx $a $p-$i',d['wall_s'],d['passed'],d['failed'],d['tokens'])"
done; done
