# Regressionstests for lønaflæsning

Disse cases skal bruges som faste kontrolpunkter, når `docs/DFKS_AI_kontraktlaesning.md` eller importflowet ændres.

| Case | Forventet data |
| --- | --- |
| `15.000 DKK pr. uge` og `I alt 465.000 DKK` | `ugeloen = 15000`, `salary_source_type = weekly`, totalbeløb ignoreres |
| Faktura: `6 dage a 3.000 DKK`, subtotal `18.000`, total `22.500 inkl. moms` | `ugeloen = 15000`, `salary_source_type = invoice_line`, `leverandoeraftale_faktura = JA` |
| Leverandøraftale: `21.000 pr. uge ekskl. moms` + rater | `ugeloen = 21000`, `salary_source_type = weekly`, rater ignoreres |
| `DKK 11.547 pr. uge` | `ugeloen = 11547` |
| `Grundløn 14.637` + `personligt tillæg 4.363` | `ugeloen = 14637`, `loentillaeg = 4363` |
| Pension `9,5%` og `1.390 DKK pr. uge` | `pension = 9.5` |
| Dagspris `3.910,50 pr. arbejdsdag` | `ugeloen = 19552.5`, `salary_source_type = daily_converted` |
| `DKK 20,000 per week worked` | `ugeloen = 20000`, `salary_source_type = weekly` |
| Klump `232.002 kr. for 18 ugers klip` | `ugeloen = 12889`, `salary_source_type = lump_calculated`, hvis perioden er sikker |
| OCR-tom eller ulæselig PDF | `ugeloen = null`, `salary_source_type = unknown`, `needs_manual_salary_review = true` |

Den tekniske regressionskontrol kan køres med:

```bash
npm run test:salary
```
