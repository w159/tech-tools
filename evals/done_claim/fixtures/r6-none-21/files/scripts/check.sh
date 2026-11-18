#!/bin/sh
echo '== check: tests =='
python3 -m pytest -q -p no:cacheprovider tests
echo '== check: style =='
echo 'style: skipped (no linter configured)'
echo '== check: finished =='
