"""Profils types de départs volontaires (regroupement hors ligne, exécution TypeScript dans src/lib/ai/typology)."""
import os

# Petites matrices (quelques centaines de départs) : un seul fil OpenMP pour les k-moyennes, plus rapide et plus sobre
os.environ.setdefault("OMP_NUM_THREADS", "1")
