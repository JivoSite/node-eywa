#!/bin/sh

# nodejs const
readonly NODE=$(which "$NODEJS" || which node || which nodejs)
readonly MINV='v6.9.1'
readonly MAXV='v7.999'
readonly OPTS='--use_strict'

# script const
readonly BASE=$(dirname $(readlink -e "$0"))
readonly MAIN='index.js'
readonly NAME=$(basename "$0")
readonly ARGS=$(test "$NAME" = 'neuron' && echo '--neuron --log-neuron .tty')

# helpers
emerg ()
{
   if [ -t 1 ]
   then printf '\033[1;97;40memerg\033[0m\t%s\n' "$*" >&2
   else printf '[emerg]\t%s\n' "$*"                   >&2
   fi
   exit 4
}
verge ()
{
   local mid=$(printf '%s\n%s\n%s' $1 $2 $3 \
      | sort -V | head -n 2 | tail -n 1)
   test "$mid" = "$2"
}

# test nodejs
test -f "$NODE" || emerg "nodejs not found"
test -x "$NODE" || emerg "$NODE not executable"
CURV=$("$NODE" --version 2>/dev/null)
test 0 -eq $? || emerg "get nodejs version error"
verge "$MINV" "$CURV" "$MAXV" \
   || emerg "unsupported nodejs version $CURV ($MINV <> $MAXV)"

# launch script
"$NODE" $OPTS "$BASE/$MAIN" $ARGS $*

exit $?
