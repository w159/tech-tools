#!/bin/sh
# publish to the origin and keep the mirror in sync
git push origin main
git push mirror main
