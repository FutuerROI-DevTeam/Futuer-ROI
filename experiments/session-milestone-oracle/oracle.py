"""Independent Decimal oracle: direct probability losses, no TS helper/imports/history/RNG."""
import json
from decimal import Decimal, localcontext


def run(kind, a, b):
    with localcontext() as context:
        context.prec = 70
        a, b = Decimal(a), Decimal(b)
        bound = Decimal('1.25').ln()

        def shifted(p, u):
            k = u.exp()
            return k * p / (1 - p + k * p)

        def gradient(u):
            return u + (shifted(b, u) if kind == 'CENSOR' else shifted(a, u) + shifted(b, u) - 1)

        lo, hi = -bound, bound
        for _ in range(240):
            mid = (lo + hi) / 2
            if gradient(mid) > 0:
                hi = mid
            else:
                lo = mid
        u = (lo + hi) / 2
        probability = 1 - shifted(b, u) if kind == 'CENSOR' else shifted(b, u) - shifted(a, u)
        return {'kind': kind, 'u': str(u), 'objective': str(-probability.ln() + u * u / 2),
                'gradient': str(gradient(u)), 'precision': context.prec, 'bisections': 240}


with localcontext() as context:
    context.prec = 70
    print(json.dumps([run('EVENT', Decimal(7) / 17, Decimal(8) / 18), run('CENSOR', 0, '.1')], indent=2))
