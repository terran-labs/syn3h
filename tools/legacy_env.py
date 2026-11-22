"""Until 22 November 2026 the game was called Syn3h and its environment variables were SYN3H_*.

They are MIRA_* now. Scripts outside the repository may still set the old names, so importing
this copies every SYN3H_<X> to MIRA_<X> unless MIRA_<X> is already set. Remove after
22 December 2026 (docs/NAMES.md).
"""
import os

for _name, _value in list(os.environ.items()):
    if _name.startswith('SYN3H_'):
        os.environ.setdefault('MIRA_' + _name[len('SYN3H_'):], _value)
