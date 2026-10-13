#!/bin/sh
# The only way the xoox-one indexer image starts (Dockerfile `indexer` target, plan 3.7). It runs the launch guard and
# then replaces itself with Envio in the same process tree, so the guard validates the environment Envio will run in.
# Everything comes from the container (docker run --env-file, mode 0600). It takes no arguments: Envio gets no
# config override and no restart flag, so the guarded ENVIO_CONFIG is the file it reads and nothing clears the database.
set -eu

if [ "$#" -ne 0 ]; then
  echo "Refusing to start the xoox-one indexer: launch.sh takes no arguments." >&2
  exit 1
fi

root=$(CDPATH= cd -P -- "$(dirname -- "$0")/.." && pwd -P)
cd "$root"

# Envio loads a .env from this directory twice (its CLI, then dotenv in JS) and fills every variable the container left
# unset from it, so the guard would never see those values. The VPS keeps the live private stack's .env here.
for dotenv in .env .env.*; do
  # .env.example is the committed template with placeholder values; Envio never loads it.
  [ "$dotenv" = ".env.example" ] && continue
  if [ -e "$dotenv" ] || [ -L "$dotenv" ]; then
    echo "Refusing to start the xoox-one indexer: $dotenv is present in the indexer directory." >&2
    exit 1
  fi
done
export DOTENV_CONFIG_PATH=/dev/null

"$root/node_modules/.bin/tsx" "$root/scripts/launch-guard.ts"
exec ./node_modules/.bin/envio start
