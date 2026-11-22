# Until 22 November 2026 the game was called Syn3h and its environment variables were SYN3H_*.
# They are MIRA_* now. Scripts outside the repository may still set the old names, so this
# exports every SYN3H_<X> as MIRA_<X> unless MIRA_<X> is already set. Sourced near the top of
# every script that reads a MIRA_ variable. Remove after 22 December 2026 (docs/NAMES.md).
for _legacy_name in $(env | sed -n 's/^SYN3H_\([A-Za-z0-9_]*\)=.*/\1/p'); do
  eval "[ -n \"\${MIRA_${_legacy_name}+x}\" ] || export MIRA_${_legacy_name}=\"\${SYN3H_${_legacy_name}}\""
done
unset _legacy_name
