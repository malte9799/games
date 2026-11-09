#!/usr/bin/env python3
"""Baut public/words/{de,en}.txt (lowercase, ein Wort pro Zeile, nur Buchstaben) und
public/words/prompts.json (Buchstabenfolgen, die in genug Wörtern vorkommen) für die Wortbombe.

Quellen (nur lokal gebraucht, nicht im Repo):
  de: https://github.com/enz/german-wordlist  (Datei `words`)
  en: https://github.com/dwyl/english-words   (Datei `words_alpha.txt`)
Aufruf: scripts/make-wordlists.py <de-quelle> <en-quelle>
"""
import re, sys, json, collections, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "words"
CFG = {  # Sprache: (erlaubte Zeichen, max. Länge, Mindest-Trefferzahl für 2 / 3 Buchstaben)
    "de": (r"[a-zäöüß]+", 26, 2000, 500),
    "en": (r"[a-z]+", 24, 1500, 250),
}

def build(lang, src):
    pat, maxlen, t2, t3 = CFG[lang]
    words = sorted({w for w in (l.strip().lower() for l in open(src, encoding="utf8"))
                    if 3 <= len(w) <= maxlen and re.fullmatch(pat, w)})
    (OUT / f"{lang}.txt").write_text("\n".join(words), encoding="utf8")
    prompts = {}
    for n, t in ((2, t2), (3, t3)):
        c = collections.Counter()
        for w in words:
            c.update({w[i:i + n] for i in range(len(w) - n + 1)})
        prompts[str(n)] = sorted(k for k, v in c.items() if v >= t)
    print(lang, len(words), "Wörter,", {k: len(v) for k, v in prompts.items()}, "Prompts")
    return prompts

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    de, en = build("de", sys.argv[1]), build("en", sys.argv[2])
    (OUT / "prompts.json").write_text(json.dumps({"de": de, "en": en}, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
